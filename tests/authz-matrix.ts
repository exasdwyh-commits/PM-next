/**
 * 表驱动权限矩阵（Phase 3A · B8）
 *
 * 目的：把「哪条路由对哪类身份应该给什么答复」变成**可回归的数据**，而不是散落在用例里的人肉断言。
 *
 * 两条硬规则：
 * 1. **新增路由未登记即判失败**：运行器会扫描 `src/app/api/**\/route.ts` 的实际导出方法，
 *    与下表逐项比对；有路由/方法没登记，或表里有已不存在的路由，一律判失败。
 * 2. **未授权身份不得得到 2xx**：这是本矩阵要守住的安全性质。
 *
 * 期望值为什么有两种形态：
 * - `number[]`：鉴权检查发生在业务校验**之前**，拒绝码是确定的，因此写精确值。
 * - `"NO_2XX"`：该路由**先做业务校验再做鉴权**（Phase 3A 实测结论，见 ACCEPTANCE.md）。
 *   空/不完整请求会先被校验器拦成 400/409/422，拿不到鉴权结论。此时只能断言
 *   「未获得成功响应」，不能假装知道拒绝码 —— 精确码需用合法载荷单独验证。
 *
 * 另注：下方出现的 tenant marker（`ZQA1`）用于跨租户内容断言：
 * 对「返回组织级集合、对任意登录用户都是 200」的读接口，仅断言状态码不足以证明隔离，
 * 必须同时断言响应体内不含他组织夹具标记。
 *
 * body 中可用的占位符（由运行器替换，保证多次运行不发生唯一键冲突）：
 *   {{RUN_TAG}}  本次运行唯一标识
 *   {{IDENTITY}} 当前身份名（anon/foreign/outsider/viewer/owner）
 * 例：`identityCode: "{{RUN_TAG}}-{{IDENTITY}}"` —— Product.identityCode 的唯一性已收敛到**组织内**
 * （TASK-008 / D-001：`@@unique([organizationId, identityCode])`）。同一组织内用固定值仍会触发唯一键
 * 冲突（409，D-015 中央映射）；跨组织复用同码已允许（回归见 `acceptance-http-errors.ts` 戊段与
 * `acceptance-authz-matrix.test.ts` 场景 6b）。
 */

export type Identity = "anon" | "foreign" | "outsider" | "viewer" | "owner";
export const IDENTITIES: Identity[] = ["anon", "foreign", "outsider", "viewer", "owner"];
export const UNAUTHORIZED: Identity[] = ["anon", "foreign", "outsider"];

/** 期望形态：精确状态码集合，或「不得成功」 */
export type Expectation = number[] | "NO_2XX";

export interface RouteSpec {
  /** 路由模板；`{param}` 由验收用例的夹具映射展开 */
  path: string;
  /**
   * HTTP 方法。
   *
   * 2026-10-09 补 `PUT`：此前联合类型漏了这个方法，而 V2 新增的 4 条路由
   * （`PUT /api/assistant/active-push`、`PUT /api/cost/scenarios/{id}`、
   * `PUT /api/cost/scenarios/{id}/approval`、`PUT /api/feedback`）确实导出 PUT。
   * 缺口本身也说明这批路由**从未被登记过**——登记时类型检查立刻会拦下来。
   */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** 鉴权口径（人类可读，用于审查表格是否自洽） */
  authz: string;
  expect: Record<Exclude<Identity, "owner">, Expectation>;
  /**
   * 资源负责人/有权身份应能通过门禁：断言「未被拒绝」（非 401/403/404）。
   * 用 "NOT_DENIED" 表示门禁之后仍可能有业务校验（422/409 都算门禁已开）。
   *
   * **5xx 不算门禁已开**：服务端异常说明路由崩了，判据必须让它红。
   * 旧的「非 401/403/404」写法会放行 500，导致半张矩阵分不清正常与崩溃（D-008）。
   */
  ownerGate: Expectation | "NOT_DENIED";
  /** 触发请求时的 body（GET/DELETE 视具体路由而定） */
  body?: unknown;
  /**
   * 附加查询串（不含 `?`）。用于**必填查询参数**的路由：
   * 这些路由在鉴权之前先做参数非空校验，不带参数时所有身份都被 422 抢先拦下，
   * 门禁等于没被测到。带上查询串能让 `requireProjectRole` 真正执行。
   *
   * 注意：它**不参与**路由登记比对（见 acceptance-authz-matrix 场景 1.1/1.2），
   * 登记键始终是不带查询串的裸路径——否则会被判成「登记项与实际路由不符」。
   */
  query?: string;
  /** 响应为组织级集合：需断言不含他组织标记 */
  crossTenant?: boolean;
  /** 标记「先校验后鉴权」的路由，便于后续收敛顺序时定位 */
  validationFirst?: boolean;
  /**
   * 标记「实现里压根没调用 getServerSession」的路由 —— 即**未登录也可访问**。
   *
   * 这不是「应当公开」的论证，而是**如实登记一个待收敛的开放面**：
   * 本字段存在的意义是让矩阵不把这类端点伪装成已鉴权，从而在审查时一眼可见。
   * 收敛方向由产品决定（补鉴权 / 或正式论证为公开端点并移入 PUBLIC_ANON_2XX 白名单）。
   */
  publicByOmission?: boolean;
  /**
   * 执行阶段。默认：GET → 1（读），其余 → 2（需角色/归属的写入）。
   *
   * 3 = **自助创建型写入**：任何组织成员都可成功，且会改变后续判定前提。
   * 典型是 `POST /api/projects`——它会新建 ProjectMember(OWNER)。
   *
   * ⚠️ 历史（2026-09-16 已修，勿回退）：在此之前 `isOrgAdmin` 的口径是
   * 「本组织任一项目的 OWNER」，因此 `POST /api/projects` 会**把调用者变成组织管理员**，
   * 解锁知识源/公司事实接口（可读到服务器 `rootPath`）。这就是「org-admin 权限自举」。
   * 现在 `isOrgAdmin` 只看 `OrganizationMember.role`，建项目不再产生任何组织级权限。
   *
   * 阶段 3 仍然保留：这些调用会**真实新建夹具**（项目 / 产品 / 会话 / 信号），
   * 排到最后执行，保证其余各格的读数不被中途新建的数据污染。
   */
  phase?: 1 | 2 | 3;
}

import { ASSISTANT_SPECS } from "./authz-matrix-parts/assistant";
import { ANALYSIS_SPECS } from "./authz-matrix-parts/analysis";
import { PROJECT_SPECS } from "./authz-matrix-parts/projects";
import { PRODUCT_SPECS } from "./authz-matrix-parts/product";
import { KNOWLEDGE_SPECS } from "./authz-matrix-parts/knowledge";
import { COST_SPECS } from "./authz-matrix-parts/cost";
import { WORKFORCE_SPECS } from "./authz-matrix-parts/workforce";
import { V2_SPECS } from "./authz-matrix-parts/v2";

/**
 * 聚合：各分域条目按拆分前顺序展开，与拆分前完全等价。
 * 新增路由时请去对应分域文件追加条目，不要直接改这里。
 */
export const AUTHZ_MATRIX: RouteSpec[] = [
  ...ASSISTANT_SPECS,
  ...ANALYSIS_SPECS,
  ...PROJECT_SPECS,
  ...PRODUCT_SPECS,
  ...KNOWLEDGE_SPECS,
  ...COST_SPECS,
  ...WORKFORCE_SPECS,
  ...V2_SPECS,
];

/**
 * 运行器要做跨租户内容断言的接口：这些接口对「任意登录用户」都返回 200，
 * 仅看状态码无法证明隔离，必须检查响应体内不含他组织夹具标记。
 */
export const CROSS_TENANT_MARKER = "ZQA1-ONLY-ORG-A";

/** 不允许出现在未授权身份响应中的内部字段名（B6 回归） */
export const FORBIDDEN_INTERNAL_KEYS = [
  "fileKey",
  "runnerPid",
  "runnerBootId",
  "verifiedByUserId",
  "submittedById",
  "reviewedById",
  "confirmedById",
];
