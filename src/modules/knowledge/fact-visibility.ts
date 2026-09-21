// ---------------------------------------------------------------------------
// 公司事实（CompanyFact）的对外可见字段口径 —— 页面与接口的唯一来源
//
// 背景（2026-09-15，Phase 3A / T1 / B1）：
//   知识页原本在服务端删掉了非管理员的 key / category，但
//   `GET /api/knowledge/facts` 直接把 `listCompanyFacts()` 的整行返回 ——
//   「页面做了收口、接口裸奔」，属于「只隐藏按钮不算权限」的同一类缺陷。
//   而且页面侧的删除是「黑名单」写法（只删两个字段），随着 schema 增长必然失守：
//   CompanyFact 上的 `sourcePath`（来源文件路径）就从未被剔除，会随 RSC 负载
//   一起到达浏览器。
//
// 现在把口径收敛到本模块：黑名单换成白名单，页面与接口共用同一份实现，
// 避免「同一事实在两个地方有两种说法」。
// ---------------------------------------------------------------------------

/**
 * 所有组织成员可见的业务字段。
 * 覆盖 knowledge-client.tsx 实际渲染的 id / label / value / status，
 * 以及有效期与确认时间这类业务信息。
 */
export const FACT_MEMBER_FIELDS = [
  "id",
  "label",
  "value",
  "status",
  "confirmedAt",
  "validFrom",
  "validUntil",
  "createdAt",
  "updatedAt",
] as const;

/**
 * 仅知识库管理员可见的内部字段：
 * - `key` / `category`  机器标识与技术分类（页面本来就只给管理员看）
 * - `sourcePath`        来源资料的服务器/导入路径
 * - `sourceDocId` / `supersededById` / `confirmedById`  内部关联 id
 * - `organizationId`    组织主键
 */
export const FACT_ADMIN_ONLY_FIELDS = [
  "key",
  "category",
  "sourceDocId",
  "sourcePath",
  "supersededById",
  "confirmedById",
  "organizationId",
] as const;

/**
 * 把一条公司事实投影为可下发给浏览器 / 接口调用方的形状。
 *
 * - `isAdmin = false`：只保留业务字段；`confirmedBy` 只给 `{ id, name }`（不带邮箱）
 * - `isAdmin = true` ：额外带上内部字段；`confirmedBy` 含 email。
 *   两个白名单并集覆盖 `CompanyFact` 的全部标量字段，因此管理员数据是无损的。
 *
 * 采用「白名单拷贝」而非「黑名单删除」：新增 schema 字段时默认不外泄，
 * 必须显式登记才会下发。
 */
export function projectCompanyFact<T extends Record<string, any>>(fact: T, isAdmin: boolean) {
  const out: Record<string, any> = {};

  for (const field of FACT_MEMBER_FIELDS) {
    if (field in fact) out[field] = (fact as any)[field];
  }

  const confirmedBy = (fact as any).confirmedBy;
  if (confirmedBy) {
    out.confirmedBy = isAdmin
      ? { id: confirmedBy.id, name: confirmedBy.name, email: confirmedBy.email }
      : { id: confirmedBy.id, name: confirmedBy.name };
  }

  if (isAdmin) {
    for (const field of FACT_ADMIN_ONLY_FIELDS) {
      if (field in fact) out[field] = (fact as any)[field];
    }
  }

  return out;
}

/** 批量版本。 */
export function projectCompanyFacts<T extends Record<string, any>>(facts: T[], isAdmin: boolean) {
  return facts.map((fact) => projectCompanyFact(fact, isAdmin));
}
