/**
 * 知识源自动同步：漂移探测 → 按需增量同步。
 *
 * 背景：`syncKnowledgeSource` 原先只能由 API 层触发（人工在 /knowledge 点「立即扫描同步」），
 * 而 rootPath 指向的是**外部目录**（Obsidian Vault 等）。别的进程 / 别的 agent 往那里写笔记时，
 * kern 无从得知 —— 库里那份副本会一直停在旧快照，检索也就一直答旧内容。
 *
 * 这里提供一个「廉价探测 + 按需同步」的单元，交给 worker 的 knowledge loop 周期调用：
 * 探测阶段只做目录遍历 + stat（不读文件内容），确认有漂移才真正跑同步
 * （后者按 sha256 逐文件比对，内容没变的文件会被整篇跳过）。
 *
 * 为什么不做文件监听：本仓库没有任何 watcher 依赖（chokidar / watchpack / @parcel/watcher 均未安装），
 * 而上层已经有一套被 supervisor 守护的 loop 调度（单轮幂等、进程随时可杀）。
 * 复用 loop 既不必新增依赖，也不会出现「监听进程静默死掉、再没人发现」的失效模式。
 */
import fs from "fs";
import path from "path";
import prisma from "@/shared/db";
import { KnowledgeSourceKind } from "@prisma/client";
import { getOrCreateSystemPrincipalSession } from "@/modules/identity/system-principal";
import { scanMarkdownFiles, syncKnowledgeSource } from "./sync";

/**
 * 时钟容差：`lastSyncAt` 记的是**同步完成时刻**，探测到的 mtime 通常都早于它，正常不会误判。
 * 留 1s 是为容纳文件系统时间戳精度与「同步途中恰好落盘」的抖动 ——
 * 否则一次抖动会让该源之后每一轮都触发全量重跑，把 worker 拖住。
 */
const MTIME_TOLERANCE_MS = 1_000;

export interface DriftProbe {
  changed: boolean;
  reason: string;
  fileCount: number;
  latestMtimeMs: number;
}

export interface AutoSyncResult {
  scanned: number;
  acted: number;
  skipped: number;
  errors: number;
  notes?: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 探测单个知识源是否漂移。任一判据成立即视为需要同步：
 *
 * 1. 从未同步过（`lastSyncAt` 为空）；
 * 2. 目录里最新 mtime 晚于上次同步完成时刻（内容被修改 / 新增）；
 * 3. 磁盘文件数 ≠ 库中未删文档数 —— **删除不会让 mtime 变大**，必须单独判，
 *    否则删掉一篇笔记后库里会永远留着它的旧切片。
 */
export async function probeKnowledgeDrift(source: {
  id: string;
  organizationId: string;
  rootPath: string;
  lastSyncAt: Date | null;
  kind?: KnowledgeSourceKind;
}): Promise<DriftProbe> {
  // 附件虚拟源没有可扫描的磁盘子树：目录文件数与附件文档数永远对不上，
  // 探测必然误判为漂移。这里直接声明无变化，附件索引只走附件编排层维护。
  if (source.kind === KnowledgeSourceKind.CONVERSATION_UPLOAD) {
    return { changed: false, reason: "附件来源不参与目录漂移探测", fileCount: 0, latestMtimeMs: 0 };
  }
  if (!fs.existsSync(source.rootPath)) {
    return { changed: false, reason: "目录不存在", fileCount: 0, latestMtimeMs: 0 };
  }

  // 复用 sync.ts 的扫描函数：跳过规则（`.` 开头 / node_modules / .trash）必须与同步口径完全一致，
  // 否则这里会把同步根本不会收录的文件算进来，导致每轮都误判成"文件数变化"。
  const relPaths = scanMarkdownFiles(source.rootPath);
  let latestMtimeMs = 0;
  for (const rel of relPaths) {
    try {
      const st = fs.statSync(path.join(source.rootPath, rel));
      if (st.mtimeMs > latestMtimeMs) latestMtimeMs = st.mtimeMs;
    } catch {
      // 文件在遍历与 stat 之间被删除或被独占：跳过即可，下一轮会得出正确结论。
    }
  }

  const lastSyncMs = source.lastSyncAt ? source.lastSyncAt.getTime() : 0;
  if (lastSyncMs === 0) {
    return { changed: true, reason: "从未同步", fileCount: relPaths.length, latestMtimeMs };
  }
  if (latestMtimeMs > lastSyncMs + MTIME_TOLERANCE_MS) {
    return { changed: true, reason: "内容有更新", fileCount: relPaths.length, latestMtimeMs };
  }

  const aliveDocs = await prisma.knowledgeDocument.count({
    where: { sourceId: source.id, organizationId: source.organizationId, deletedAt: null },
  });
  if (relPaths.length !== aliveDocs) {
    return {
      changed: true,
      reason: `文件数变化 ${aliveDocs} → ${relPaths.length}`,
      fileCount: relPaths.length,
      latestMtimeMs,
    };
  }

  return { changed: false, reason: "无变化", fileCount: relPaths.length, latestMtimeMs };
}

/**
 * 探测所有启用的知识源，只对真正漂移的源跑增量同步。
 *
 * `limit` 限制的是**单轮最多同步几个源**（而非最多探测几个）：单个源的全量同步可能要十几秒，
 * 一轮多开会把整轮拖长。本轮因达上限而跳过的源不会被漏掉 —— 是否漂移每轮都重新判定。
 */
export async function syncDriftedKnowledgeSources(
  options: { organizationId?: string; limit?: number } = {}
): Promise<AutoSyncResult> {
  const result: AutoSyncResult = { scanned: 0, acted: 0, skipped: 0, errors: 0 };
  const notes: string[] = [];

  // 按 kind 排除附件虚拟源：它的文档以附件记录为逻辑集合，不在任何磁盘目录里，
  // 连探测都不该跑（文件数判据必然误判），更不能进 syncKnowledgeSource。
  const sources = await prisma.knowledgeSource.findMany({
    where: {
      enabled: true,
      kind: { not: KnowledgeSourceKind.CONVERSATION_UPLOAD },
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
    },
    select: { id: true, organizationId: true, rootPath: true, lastSyncAt: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  const maxSync = Math.max(1, options.limit ?? 1);
  let synced = 0;

  for (const source of sources) {
    result.scanned += 1;

    let probe: DriftProbe;
    try {
      probe = await probeKnowledgeDrift(source);
    } catch (error) {
      result.errors += 1;
      notes.push(`${source.name} 探测失败：${errorMessage(error)}`);
      continue;
    }

    if (!probe.changed) {
      result.skipped += 1;
      continue;
    }

    if (synced >= maxSync) {
      result.skipped += 1;
      notes.push(`${source.name} 待同步（本轮已达上限 ${maxSync}）`);
      continue;
    }

    try {
      // 同步必须用**该源所属组织**的身份：syncKnowledgeSource 会核对
      // source.organizationId === session.organizationId，用错组织直接 NotFound。
      const session = await getOrCreateSystemPrincipalSession(source.organizationId);
      const run = await syncKnowledgeSource(session, source.id);
      synced += 1;
      result.acted += 1;
      notes.push(
        `${source.name} 自动同步（${probe.reason}）scanned=${run.scanned} created=${run.created} updated=${run.updated} deleted=${run.deleted}`
      );
    } catch (error) {
      result.errors += 1;
      notes.push(`${source.name} 同步失败：${errorMessage(error)}`);
    }
  }

  if (notes.length) result.notes = notes;
  return result;
}
