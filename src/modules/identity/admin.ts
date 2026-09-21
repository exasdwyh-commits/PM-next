import { ForbiddenError } from "@/shared/errors";
import { OrgRole } from "@prisma/client";
import { SessionContext } from "./session";
import { getOrganizationRole } from "./org-membership";

// ---------------------------------------------------------------------------
// 公司级知识库管理员判定
//
// 口径（2026-09-16 起，PC-0 Final Security Patch）：
//   用户在其所属组织内持有 `OrganizationMember.role = ORG_ADMIN`，
//   才视为组织管理员（可维护知识源、触发扫描同步、录入/确认公司事实）。
//
// 历史与修复（务必不要回退）：
//   本文件此前的口径是「本组织内对任意一个项目持有 ORG_ADMIN 或 OWNER」。
//   因为任何组织成员都能创建项目并因此成为该项目的 OWNER，这个口径等价于
//   **任何成员都能把自己变成组织管理员**（权限自举），进而读取知识来源配置
//   （含服务器 `rootPath`）。B8 权限矩阵已实测复现该路径。
//
//   现在：组织级判定**只看 OrganizationMember**。用户哪怕是自己项目的 OWNER，
//   也不会因此获得公司级能力。未经本表单显式授予，一律不是管理员。
//
//   注意：`Role.ORG_ADMIN` 作为**项目角色**的枚举值仍然存在（历史数据兼容），
//   但它对 `isOrgAdmin` **不再有任何影响**。项目角色只决定项目内能力。
// ---------------------------------------------------------------------------

/** 读取当前会话用户在所属组织内的公司级角色（无记录返回 null）。 */
export async function getCurrentOrgRole(session: SessionContext): Promise<OrgRole | null> {
  if (!session?.userId || !session?.organizationId) return null;
  return getOrganizationRole(session.userId, session.organizationId);
}

/**
 * 判断当前会话用户是否为本组织的知识库管理员。
 *
 * 无成员记录 = 非管理员（不推断、不回退）。
 */
export async function isOrgAdmin(session: SessionContext): Promise<boolean> {
  const role = await getCurrentOrgRole(session);
  return role === OrgRole.ORG_ADMIN;
}

/**
 * 非知识库管理员时抛出 ForbiddenError（由统一错误处理器转为 403）。
 */
export async function assertOrgAdmin(session: SessionContext): Promise<void> {
  if (!(await isOrgAdmin(session))) {
    throw new ForbiddenError("知识源配置与事实录入仅限管理员操作");
  }
}
