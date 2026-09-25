import { Role } from "@prisma/client";
import prisma from "@/shared/db";
import { NotFoundError } from "@/shared/errors";
import { getOrCreateSystemPrincipalSession } from "@/modules/identity/system-principal";
import type { SessionContext } from "@/modules/identity/session";

/**
 * Worker 的系统身份。
 *
 * 复用既有的 `getOrCreateSystemPrincipalSession`（每个组织一个保留身份
 * `system+<orgId>@hermes.invalid`，isSystem=true、无口令、不可登录），
 * 而不是新造 `worker@hermes.test` 账号：
 * - 语义一致：这就是「内部自动化身份」的既有定义（autopilot 也在用）；
 * - 不引入可登录的弱账号；
 * - 不新增迁移。
 */
const sessionCache = new Map<string, SessionContext>();

export async function resolveWorkerSession(
  organizationId: string
): Promise<SessionContext> {
  const cached = sessionCache.get(organizationId);
  if (cached) return cached;
  const session = await getOrCreateSystemPrincipalSession(organizationId);
  sessionCache.set(organizationId, session);
  return session;
}

/** 测试/多组织场景下清空进程内身份缓存。 */
export function resetWorkerSessionCache(): void {
  sessionCache.clear();
}

const provisionedProjects = new Set<string>();

/**
 * 确保系统身份在目标项目上有合法角色。
 *
 * 为什么需要：`startAgentTask` / `finishAgentTask` / `delegateAgentTask` /
 * `advanceProductRndProgram` 都走 `requireProjectRole(..., [OWNER, DECISION_MAKER])`。
 * 系统身份按设计**没有**组织成员/项目角色（见 system-principal.ts 的不变量注释），
 * 所以 Worker 必须显式、幂等地为自己补上项目角色，否则一条任务都执行不了。
 *
 * 为什么用 DECISION_MAKER 而不是 Role.DIGITAL_WORKER：
 * 现有服务函数的白名单只接受 OWNER / DECISION_MAKER；`Role.DIGITAL_WORKER`
 * 虽然存在于枚举里，但没有任何服务函数认它。改用更窄的角色需要先给这些函数
 * 扩白名单（见 DESIGN 文档的 follow-up），本次为控制影响面不动治理代码。
 *
 * 边界（Worker 侧硬约束，不依赖角色）：
 * - 只对「确实有本 Worker 待执行任务」的项目授权，不做全量预授权；
 * - Worker 代码里不存在调用审批 / Gate / ToolBroker 的路径。
 */
export async function ensureWorkerProjectAccess(
  session: SessionContext,
  projectId: string
): Promise<void> {
  const existing = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: session.userId } },
    select: { id: true },
  });
  if (existing) return;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { organizationId: true },
  });
  if (!project || project.organizationId !== session.organizationId) {
    throw new NotFoundError("Project not found for worker access provisioning");
  }

  // upsert 保证并发 loop 同时授权不会互相打架（P2002）。
  const member = await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId, userId: session.userId } },
    update: {},
    create: { projectId, userId: session.userId, role: Role.DECISION_MAKER },
    select: { role: true },
  });
  if (!provisionedProjects.has(projectId)) {
    provisionedProjects.add(projectId);
    console.log(
      `[pm-worker] 已为系统身份补项目角色 project=${projectId} role=${member.role}`
    );
  }
}

/** 测试用：清空「已授权项目」日志去重集合。 */
export function resetWorkerProjectAccessCache(): void {
  provisionedProjects.clear();
}
