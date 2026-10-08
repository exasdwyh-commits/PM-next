/**
 * P0-B 幂等绑定 - ResearchRun idempotency
 * researchRun idempotencyKey = missionId + nodeKey + revisionRound
 * Mission 继续/重试优先续跑/复用已有 ResearchRun, 不得重新抓网页、重复付模型费
 */

export interface ResearchRunKey {
  missionId: string;
  nodeKey: string;
  revisionRound: number;
}

export function buildIdempotencyKey(key: ResearchRunKey): string {
  return `${key.missionId}::${key.nodeKey}::r${key.revisionRound}`;
}

export interface ResearchRun {
  id: string;
  idempotencyKey: string;
  missionId: string;
  nodeKey: string;
  revisionRound: number;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "BLOCKED";
  sourceCaptures: any[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
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
    if (existing.status === "SUCCEEDED" || existing.status === "RUNNING") {
      return { run: existing, reused: true, reason: `复用已有 ResearchRun ${existing.id} (${existing.status}), 避免重复抓网页付费` };
    }

    if (existing.status === "FAILED" || existing.status === "BLOCKED") {
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
      status: "PENDING",
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
    statuses: ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "BLOCKED"],
  };
}
