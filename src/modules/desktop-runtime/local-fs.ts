import { promises as fs } from "node:fs";
import path from "node:path";
import type { ExistingDesktopTarget } from "./contracts";

/**
 * 本机文件操作（仅 Node / 执行端使用，**不要**从 desktop-runtime/index.ts 导出——
 * contracts.ts 会被客户端组件引用，这里依赖 node:fs）。
 *
 * 覆盖保护：写入与移动在目标已存在时不做任何修改，返回 EXISTS，由调用方转成
 * WAITING_HUMAN 让用户决定；只有指令显式要求覆盖（overwrite）或追加（append）时才动已有内容。
 * 见 governance/protected-actions.ts 的 IRREVERSIBLE_DELETE_OR_OVERWRITE。
 */

async function describeExisting(target: string): Promise<ExistingDesktopTarget | null> {
  try {
    const stat = await fs.lstat(target);
    return {
      path: target,
      kind: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function isSameEntry(a: string, b: string): Promise<boolean> {
  try {
    const [sa, sb] = await Promise.all([fs.lstat(a), fs.lstat(b)]);
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}

export type LocalWriteOutcome =
  | { status: "WRITTEN" | "APPENDED" | "OVERWRITTEN" }
  | { status: "EXISTS"; existing: ExistingDesktopTarget };

export async function writeTextFile(
  target: string,
  content: string,
  options: { append?: boolean; overwrite?: boolean } = {}
): Promise<LocalWriteOutcome> {
  await fs.mkdir(path.dirname(target), { recursive: true });

  if (options.append) {
    await fs.appendFile(target, content, "utf8");
    return { status: "APPENDED" };
  }

  if (options.overwrite) {
    const existed = await describeExisting(target);
    await fs.writeFile(target, content, "utf8");
    return { status: existed ? "OVERWRITTEN" : "WRITTEN" };
  }

  // 排他创建：存在检查与写入是同一个原子操作，没有「先查后写」的竞态窗口。
  try {
    await fs.writeFile(target, content, { encoding: "utf8", flag: "wx" });
    return { status: "WRITTEN" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const existing = await describeExisting(target);
      if (existing) return { status: "EXISTS", existing };
    }
    throw error;
  }
}

export type LocalMoveOutcome =
  | { status: "MOVED" | "OVERWRITTEN" }
  | { status: "EXISTS"; existing: ExistingDesktopTarget };

export async function moveEntry(
  from: string,
  to: string,
  options: { overwrite?: boolean } = {}
): Promise<LocalMoveOutcome> {
  const existing = await describeExisting(to);
  // 同一个条目（例如大小写不敏感文件系统上只改大小写）不算覆盖。
  const clobbers = existing !== null && !(await isSameEntry(from, to));
  if (clobbers && !options.overwrite) return { status: "EXISTS", existing: existing! };

  await fs.mkdir(path.dirname(to), { recursive: true });
  // 已知限制：检查与 rename 之间目标仍可能被第三方创建。Node 没有跨平台的
  // no-clobber rename；这里防的是「Kern 按指令覆盖了用户已有文件」，不是并发写者。
  await fs.rename(from, to);
  return { status: clobbers ? "OVERWRITTEN" : "MOVED" };
}
