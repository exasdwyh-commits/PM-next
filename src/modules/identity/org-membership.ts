import { OrgRole } from "@prisma/client";
import prisma from "@/shared/db";

// ---------------------------------------------------------------------------
// 组织成员关系（PC-0 Final Security Patch，2026-09-16）
//
// 存在理由：在此之前，schema 里没有「组织级成员表」，`isOrgAdmin` 只能拿
// 「本组织任一项目的 OWNER」当代理。而任何成员都能创建项目并因此成为 OWNER ——
// 于是任何人都能**自举**成「组织管理员」，解锁知识源配置（含服务器 rootPath）。
// 这是权限语义本身的洞，不是页面问题。
//
// 现在：组织级能力只由本表决定；项目级能力仍由 `ProjectMember` 决定。
// 两者严格分离，互不推断。
//
// 本模块**不做人事系统**：没有部门、岗位、汇报线、职位等级（明确冻结）。
// ---------------------------------------------------------------------------

/** 允许在事务客户端上调用（seed / 建号 / 业务事务内均可复用）。 */
type MembershipClient = {
  organizationMember: {
    upsert(args: unknown): Promise<{ id: string; role: OrgRole }>;
    findUnique(args: unknown): Promise<{ role: OrgRole } | null>;
  };
};

export interface EnsureOrganizationMemberParams {
  organizationId: string;
  userId: string;
  /** 默认 MEMBER。只有显式传 ORG_ADMIN 才会授予公司级能力。 */
  role?: OrgRole;
}

/**
 * 幂等地保证用户在其组织内有一条成员记录。
 *
 * 升级语义（重要）：`role = ORG_ADMIN` 会覆盖为 ORG_ADMIN；
 * 传 `MEMBER` 时**不会**把已有的 ORG_ADMIN 降级 —— 隐式降级会让「谁被撤了权」
 * 变成实现细节，而撤权必须是一次显式的、可审计的动作（需要时单独写一条更新）。
 * 因此本函数只会「补齐」或「提升」，绝不静默降权。
 */
export async function ensureOrganizationMember(
  client: MembershipClient,
  params: EnsureOrganizationMemberParams
): Promise<{ id: string; role: OrgRole }> {
  const role = params.role ?? OrgRole.MEMBER;
  return client.organizationMember.upsert({
    where: {
      organizationId_userId: { organizationId: params.organizationId, userId: params.userId },
    },
    create: { organizationId: params.organizationId, userId: params.userId, role },
    update: role === OrgRole.ORG_ADMIN ? { role: OrgRole.ORG_ADMIN } : {},
    select: { id: true, role: true },
  });
}

/** 便利版：直接用全局 prisma 客户端。 */
export async function ensureOrganizationMemberDirect(params: EnsureOrganizationMemberParams) {
  return ensureOrganizationMember(prisma as unknown as MembershipClient, params);
}

/**
 * 读取用户在所属组织内的成员角色。
 * **未持有成员记录一律返回 null（= 非管理员）**，绝不回退到项目角色推断 ——
 * 任何形式的回退都会把自举漏洞重新打开。
 */
export async function getOrganizationRole(
  userId: string,
  organizationId: string
): Promise<OrgRole | null> {
  if (!userId || !organizationId) return null;
  const member = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { role: true },
  });
  return member?.role ?? null;
}
