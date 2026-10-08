/**
 * P0-B 幂等绑定 - ResearchRun idempotency
 * researchRun idempotencyKey = missionId + nodeKey + revisionRound
 * Mission 继续/重试优先续跑/复用已有 ResearchRun, 不得重新抓网页、重复付模型费
 */

import type { ResearchRun as PrismaResearchRun } from "@prisma/client";

/**
 * 与 Prisma 的 `ResearchRun` 模型一致（本模块的 helper 直接返回数据库行）。
 *
 * 这里原先手写了一份接口，字段与模型对不上：`idempotencyKey` 在库里可空、
 * `status` 是 `ResearchRunStatus` 枚举而非字符串字面量联合、且缺 `projectId` /
 * `createdById` / `errorReason` 等列。结果是调用方把 `prisma.researchRun.update()`
 * 的返回值赋回来时被判为不可赋值（TS2322）。直接复用生成类型即可消除这类漂移。
 *
 * 注：`sourceCaptures` 只在「复用」分支通过 `include` 取到，其余分支没有该关系；
 * Prisma 的模型类型把它声明为数组，但未 include 时运行期不存在，读取前需自行判空。
 */
export type ResearchRun = PrismaResearchRun;

export interface ResearchRunKey {
  missionId: string;
  nodeKey: string;
  revisionRound: number;
}

export function buildIdempotencyKey(key: ResearchRunKey): string {
  return `${key.missionId}::${key.nodeKey}::r${key.revisionRound}`;
}

export async function findOrReuseResearchRun(
  prisma: any,
  key: ResearchRunKey,
  options: { allowExpired?: boolean; forceNew?: boolean } = {}
): Promise<{ run: ResearchRun | null; reused: boolean; reason: string }> {
  const idempotencyKey = buildIdempotencyKey(key);

  // 1. 查找已有
  const existing = await prisma.researchRun.findFirst({
    where: { idempotencyKey, missionId: key.missionId },
    orderBy: { createdAt: "desc" },
    include: { sourceCaptures: true },
  });

  if (existing && !options.forceNew) {
    // 2. 检查是否过期
    const isExpired = existing.expiresAt && new Date(existing.expiresAt) < new Date();
    if (isExpired && !options.allowExpired) {
      return { run: null, reused: false, reason: `已有 ResearchRun ${existing.id} 已过期, 需新建` };
    }

    // 3. 复用
    // ResearchRunStatus 的实际取值只有 RUNNING / PUBLISHED / FAILED（见 schema.prisma），
    // 没有 SUCCEEDED / BLOCKED —— 原先拿这两个值判断属于永不成立的死分支，已按枚举改正。
    if (existing.status === "PUBLISHED" || existing.status === "RUNNING") {
      return { run: existing, reused: true, reason: `复用已有 ResearchRun ${existing.id} (${existing.status}), 避免重复抓网页付费` };
    }

    if (existing.status === "FAILED") {
      // 失败的可以续跑
      return { run: existing, reused: true, reason: `续跑已有 ResearchRun ${existing.id} (${existing.status})` };
    }
  }

  // 4. 需新建
  return { run: null, reused: false, reason: `无可用 ResearchRun, 需新建 idempotencyKey=${idempotencyKey}` };
}

export async function createResearchRun(prisma: any, key: ResearchRunKey): Promise<ResearchRun> {
  const idempotencyKey = buildIdempotencyKey(key);
  return prisma.researchRun.create({
    data: {
      idempotencyKey,
      missionId: key.missionId,
      nodeKey: key.nodeKey,
      revisionRound: key.revisionRound,
      // 新建即「在途」：ResearchRunStatus 没有 PENDING，默认值也是 RUNNING。
      status: "RUNNING",
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7天过期
    },
  });
}

export function describeIdempotency() {
  return {
    keyFormat: "missionId + nodeKey + revisionRound",
    example: "mission_123::research_market::r2",
    reusePolicy: "Mission 继续/重试优先续跑/复用, 不得重新抓网页重复付费, 只有证据过期或用户要求刷新才新建",
    expiration: "7天",
    statuses: ["RUNNING", "PUBLISHED", "FAILED"],
  };
}
