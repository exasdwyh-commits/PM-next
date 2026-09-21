import prisma from "@/shared/db";
import { UnprocessableEntityError } from "@/shared/errors";
import { SessionContext } from "./session";

// ---------------------------------------------------------------------------
// 外部 ID 归属校验（Phase 3A · B5）
//
// 原则：**请求体里传来的任何 id 都是不可信输入**，必须由服务端校验归属后才能落库。
// 仅靠前端下拉框限制不构成任何安全保障。
//
// 错误口径（与既有先例一致）：
//   `src/modules/launch/service.ts:556` 校验 evidenceId 时使用 422 +
//   「引用的…不存在或不属于当前组织」——**同一个错误同时覆盖「不存在」与「不属于你」**，
//   因此不泄露被引用对象是否存在。本模块沿用该口径，不引入 404/403 的区分，
//   否则攻击者可据状态码差异枚举其它组织 / 其它项目的对象 id。
//
// 注意：这里的 422 与「资源路由本身的跨组织访问」不同。后者（如访问别人的产品）
// 由 requireProductRole 返回 404，同样不泄露存在性。两者都满足「不泄露存在性」要求，
// 但语义不同：路由参数是"我要访问这个对象"，请求体 id 是"我要引用这个对象"。
// ---------------------------------------------------------------------------

/** 解析出用户，并确保其属于当前组织且处于活跃状态 */
export async function assertOrgUser(
  session: SessionContext,
  userId: string,
  label: string = "用户"
): Promise<{ id: string; name: string }> {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new UnprocessableEntityError(`${label}必须是非空 id`);
  }
  const user = await prisma.user.findUnique({
    where: { id: userId.trim() },
    select: { id: true, name: true, organizationId: true, isActive: true },
  });
  if (!user || !user.isActive || user.organizationId !== session.organizationId) {
    throw new UnprocessableEntityError(`引用的${label}不存在或不属于当前组织`);
  }
  return { id: user.id, name: user.name };
}

/**
 * 校验工作项归属：必须存在，且其所属项目在当前组织内。
 * 若给出 `productId`，还要求该项目绑定在该产品下 —— 防止把**其它产品/项目**的
 * workItem 关联进来（跨项目引用）。
 */
export async function assertWorkItemRef(
  session: SessionContext,
  workItemId: string,
  options: { productId?: string; label?: string } = {}
): Promise<{ id: string; projectId: string }> {
  const label = options.label ?? "工作项";
  if (typeof workItemId !== "string" || !workItemId.trim()) {
    throw new UnprocessableEntityError(`${label}必须是非空 id`);
  }
  const item = await prisma.workItem.findUnique({
    where: { id: workItemId.trim() },
    select: { id: true, projectId: true, project: { select: { organizationId: true, productId: true } } },
  });
  if (!item || item.project.organizationId !== session.organizationId) {
    throw new UnprocessableEntityError(`引用的${label}不存在或不属于当前组织`);
  }
  if (options.productId && item.project.productId !== options.productId) {
    throw new UnprocessableEntityError(`引用的${label}不属于该产品关联的项目`);
  }
  return { id: item.id, projectId: item.projectId };
}

/** 校验知识文档归属（来源文档只能引用本组织的） */
export async function assertKnowledgeDocumentRef(
  session: SessionContext,
  documentId: string,
  label: string = "来源文档"
): Promise<{ id: string }> {
  if (typeof documentId !== "string" || !documentId.trim()) {
    throw new UnprocessableEntityError(`${label}必须是非空 id`);
  }
  const doc = await prisma.knowledgeDocument.findUnique({
    where: { id: documentId.trim() },
    select: { id: true, organizationId: true },
  });
  if (!doc || doc.organizationId !== session.organizationId) {
    throw new UnprocessableEntityError(`引用的${label}不存在或不属于当前组织`);
  }
  return { id: doc.id };
}

/** 校验被引用的公司事实归属（被替代事实只能引用本组织的） */
export async function assertCompanyFactRef(
  session: SessionContext,
  factId: string,
  label: string = "被替代事实"
): Promise<{ id: string }> {
  if (typeof factId !== "string" || !factId.trim()) {
    throw new UnprocessableEntityError(`${label}必须是非空 id`);
  }
  const fact = await prisma.companyFact.findUnique({
    where: { id: factId.trim() },
    select: { id: true, organizationId: true },
  });
  if (!fact || fact.organizationId !== session.organizationId) {
    throw new UnprocessableEntityError(`引用的${label}不存在或不属于当前组织`);
  }
  return { id: fact.id };
}
