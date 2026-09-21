import prisma from "@/shared/db";
import { ForbiddenError, NotFoundError } from "@/shared/errors";
import { Role } from "@prisma/client";
import { SessionContext } from "./session";
import { isOrgAdmin } from "./admin";

// ---------------------------------------------------------------------------
// 产品级授权门禁（Phase 3A · B4）
//
// 背景：本轮之前，产品相关写路径（发布版本 / 运行分析 / 采纳修订）只校验
// `product.organizationId === session.organizationId` —— 即「同组织的任意用户
// 可操作本组织的任意产品」，属于「有身份、无授权」。
//
// 本模块把已在 `src/modules/launch/service.ts:76` 存在的产品级口径
// （assertLaunchWritePermission：产品 → 关联项目的成员 → 角色）提取为统一入口，
// 避免每个模块各写一套判断。
//
// 口径（与 launch 模块保持一致）：
//   一个产品可以关联**多个项目**（Product.projects）。只要用户在**其中任意一个**
//   关联项目里持有允许的角色，即视为对该产品有权限。归属项目（用于回写 projectId）
//   的选取必须确定性：优先 OWNER，其次按角色优先级，最后按 projectId 升序兜底。
//
// 安全设计（重要，勿随手放宽）：
//   1. 产品不存在 与 产品属于其它组织 返回**同一个 404**，不泄露对象是否存在。
//   2. 同组织、但不在任何关联项目中 → 403（非成员）。
//   3. 同组织、在关联项目中但角色不允许 → 403（低权限越权）。
//   4. 产品**没有任何关联项目**（历史遗留数据，例如仅通过 POST /api/products
//      创建、未走入库流程的产品）→ 此时不存在「产品成员」概念，退回
//      「组织管理员（isOrgAdmin 口径）」判定。2026-09-16 起 `isOrgAdmin` 只看
//      `OrganizationMember.role = ORG_ADMIN`，不再由「项目 OWNER」推断，
//      因此本分支的通路已被收紧 —— 「建个项目就把自己变成管理员」不再成立。
//
// 读 vs 写（2026-09-16 拍板，见 PRODUCT_CENTER_CONTRACTS.md §8.2）：
//   Hermes 是**内部产品中心**，不是客户隔离型 SaaS。对小团队来说，产品信息在组织内
//   默认透明比「只有项目成员才看得到」更符合真实协作。因此：
//     - 读：同组织的任何成员都可读（`requireProductRead`）。跨组织仍 404。
//     - 写：必须在关联项目中持有项目角色（`requireProductRole` + PRODUCT_WRITE_ROLES）。
//   若将来真出现「保密新品」，再引入 `visibility = ORG / PROJECT / RESTRICTED`，
//   **不要**现在把所有读取都项目化。
// ---------------------------------------------------------------------------

/**
 * 写入产品所需角色（发布版本、运行分析、采纳修订、落地上市计划）。
 * 读路径**不再**按角色判定，改为「同组织即可读」，见 `requireProductRead`。
 */
export const PRODUCT_WRITE_ROLES: Role[] = [Role.OWNER, Role.DECISION_MAKER];

/** 归属项目选取时的角色优先级（越靠前越优先），未列出的角色排在最后 */
const ROLE_PRECEDENCE: Role[] = [
  Role.OWNER,
  Role.ORG_ADMIN,
  Role.DECISION_MAKER,
  Role.FEEDBACK_PROVIDER,
  Role.VIEWER,
];

export interface ProductMembership {
  projectId: string;
  role: Role;
}

export interface ProductAccessOk {
  product: { id: string; name: string; organizationId: string };
  /** 允许角色中命中的成员关系（project_member 路径下非空） */
  memberships: ProductMembership[];
  /** 该产品归属项目（写入时作为 projectId 回退值）；projectless 遗留数据为 null */
  projectId: string | null;
  /** 判定所依据的路径，便于审计与报告 */
  grantedBy: "project_member" | "org_admin_projectless";
}

function pickOwningProjectId(memberships: ProductMembership[]): string | null {
  if (memberships.length === 0) return null;
  const owner = memberships
    .filter((m) => m.role === Role.OWNER)
    .sort((a, b) => a.projectId.localeCompare(b.projectId))[0];
  if (owner) return owner.projectId;

  const rank = (role: Role) => {
    const idx = ROLE_PRECEDENCE.indexOf(role);
    return idx === -1 ? ROLE_PRECEDENCE.length : idx;
  };
  return [...memberships]
    .sort((a, b) => rank(a.role) - rank(b.role) || a.projectId.localeCompare(b.projectId))[0]
    .projectId;
}

/**
 * 产品授权门禁。通过返回授权上下文，否则抛 404 / 403。
 *
 * 只用于**写路径**：发布版本、运行分析、采纳修订、落地上市计划。
 * 读路径请用 `requireProductRead`（同组织可读，不按项目角色）。
 *
 * @param allowedRoles 明确声明允许的角色，通常是 PRODUCT_WRITE_ROLES。
 *                     **不要**为了省事统一传 [Role.OWNER]，也不要把它用于读路径。
 */
export async function requireProductRole(
  session: SessionContext,
  productId: string,
  allowedRoles: Role[]
): Promise<ProductAccessOk> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, organizationId: true },
  });

  // 不泄露存在性：跨组织与不存在同码同文案
  if (!product || product.organizationId !== session.organizationId) {
    throw new NotFoundError("Product not found");
  }

  const [memberships, projectCount] = await Promise.all([
    prisma.projectMember.findMany({
      where: {
        userId: session.userId,
        project: { productId: product.id, organizationId: session.organizationId },
      },
      select: { projectId: true, role: true },
    }),
    prisma.project.count({
      where: { productId: product.id, organizationId: session.organizationId },
    }),
  ]);

  // 遗留数据：产品未绑定任何项目 → 退回组织管理员（过渡规则，见文件头 4）
  if (projectCount === 0) {
    if (!(await isOrgAdmin(session))) {
      throw new ForbiddenError("该产品尚未绑定项目，仅组织管理员可操作");
    }
    return { product, memberships: [], projectId: null, grantedBy: "org_admin_projectless" };
  }

  if (memberships.length === 0) {
    throw new ForbiddenError("You are not a member of this product's project");
  }

  const allowed = memberships.filter((m) => allowedRoles.includes(m.role));
  if (allowed.length === 0) {
    const held = Array.from(new Set(memberships.map((m) => m.role))).sort().join("/");
    throw new ForbiddenError(`Action not permitted for role ${held}`);
  }

  return {
    product,
    memberships: allowed,
    projectId: pickOwningProjectId(allowed),
    grantedBy: "project_member",
  };
}

/**
 * 产品**读**门禁（2026-09-16 拍板：组织内成员可读本组织产品）。
 *
 * 与写路径的关键差别：读**只看组织归属**，不看项目成员身份。
 * 理由：Hermes 面向公司内部一个小团队，产品信息在组织内默认透明更符合协作实际；
 * 把读取都项目化会让「同事看不到同公司产品」变成日常摩擦，收益为零。
 *
 * 仍然保持的硬约束：
 *   - 跨组织与不存在返回**同一个 404**，不泄露对象存在性。
 *   - 这是**读**门禁。任何写入仍需 `requireProductRole` + PRODUCT_WRITE_ROLES。
 *   - 若将来出现「保密新品」，引入 `visibility = ORG / PROJECT / RESTRICTED`
 *     （在 `Product` 上加列），在此函数内按可见性分支，而不是给所有读加项目角色。
 */
export async function requireProductRead(
  session: SessionContext,
  productId: string
): Promise<{ id: string; name: string; organizationId: string }> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, organizationId: true },
  });

  // 不泄露存在性：跨组织与不存在同码同文案
  if (!product || product.organizationId !== session.organizationId) {
    throw new NotFoundError("Product not found");
  }

  return product;
}

/**
 * 非抛出版本：用于决定 UI 是否展示写入入口（canEdit）。
 * 权限收口不能只靠隐藏按钮 —— 服务端仍必须调用 requireProductRole。
 */
export async function hasProductRole(
  session: SessionContext,
  productId: string,
  allowedRoles: Role[]
): Promise<boolean> {
  try {
    await requireProductRole(session, productId, allowedRoles);
    return true;
  } catch {
    return false;
  }
}
