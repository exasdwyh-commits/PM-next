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
  method: "GET" | "POST" | "PATCH" | "DELETE";
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
  /** 响应为组织级集合：需断言不含他组织标记 */
  crossTenant?: boolean;
  /** 标记「先校验后鉴权」的路由，便于后续收敛顺序时定位 */
  validationFirst?: boolean;
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

export const AUTHZ_MATRIX: RouteSpec[] = [
  // ---------- 认证与公开 ----------
  {
    path: "/api/auth/session",
    method: "GET",
    authz: "登录态自省：匿名 401，登录用户返回自身会话",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/auth/session",
    method: "POST",
    authz: "登录：需要合法凭证，不鉴权（本身即入口）",
    expect: { anon: "NO_2XX", foreign: "NO_2XX", outsider: "NO_2XX", viewer: "NO_2XX" },
    ownerGate: "NOT_DENIED",
    body: {},
  },
  {
    path: "/api/auth/session",
    method: "DELETE",
    authz: "登出：幂等，未携带有效会话时同样 200（不构成越权面）",
    expect: { anon: [200], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
  },

  // ---------- 健康检查 ----------
  {
    path: "/api/health",
    method: "GET",
    authz: "存活探针：公开，仅返回 status，不泄露库名/版本（B3）",
    expect: { anon: [200], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/health/details",
    method: "GET",
    authz: "运行详情：登录即可读，不含库名/版本等内部标识（B3）",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    crossTenant: true,
  },

  // ---------- 附件 ----------
  {
    path: "/api/attachments/{id}",
    method: "GET",
    authz: "项目内成员可下载；响应绝不包含 fileKey（B6）",
    expect: { anon: [401], foreign: [404], outsider: [403], viewer: [200] },
    ownerGate: [200],
  },

  // ---------- 顾问会话 ----------
  {
    path: "/api/conversations",
    method: "GET",
    authz: "仅返回本组织会话（跨组织必须看不到他组织行）",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    crossTenant: true,
  },
  {
    path: "/api/conversations",
    method: "POST",
    authz: "任何组织成员可在自己组织内新建会话；不得写入他组织",
    expect: { anon: [401], foreign: [201], outsider: [201], viewer: [201] },
    ownerGate: [201],
    body: { title: "矩阵会话探测" },
    phase: 3,
  },
  {
    path: "/api/conversations/{id}/messages",
    method: "POST",
    authz: "会话归属校验：非组织内本人会话一律 404；校验前有内容非空检查",
    expect: { anon: [401], foreign: [404], outsider: [404], viewer: [404] },
    ownerGate: [201],
    body: { content: "矩阵探测消息" },
    validationFirst: true,
  },

  {
    path: "/api/advisor/challenge",
    method: "POST",
    authz: "证伪式审查报告：需登录；纯函数计算不读写他组织数据，组织内成员一律可调用",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    body: {
      productName: "矩阵探测产品",
      proposedClaim: "支持健康老龄化",
      ingredients: [],
    },
    phase: 3,
  },

  // ---------- 决策包 ----------
  {
    path: "/api/decision-packets/{id}/submit",
    method: "POST",
    authz: "提交冻结：仅项目 OWNER",
    expect: { anon: [401], foreign: [404], outsider: [403], viewer: [403] },
    ownerGate: [200],
  },
  {
    path: "/api/decision-packets/{id}/decide",
    method: "POST",
    authz: "打样门裁决：仅指定决策人可批；负责人不得自批（A05）。owner 期望为「被拒」，故用 NO_2XX",
    expect: { anon: [401], foreign: "NO_2XX", outsider: "NO_2XX", viewer: "NO_2XX" },
    ownerGate: "NO_2XX",
    body: { decision: "APPROVE", reason: "矩阵探测" },
    validationFirst: true,
  },

  // ---------- 证据 ----------
  {
    path: "/api/evidences/{id}/verify",
    method: "POST",
    authz: "核验证据：仅项目 OWNER",
    expect: { anon: [401], foreign: [404], outsider: [403], viewer: [403] },
    ownerGate: "NOT_DENIED",
  },
  {
    path: "/api/projects/{id}/evidences",
    method: "POST",
    authz: "录入证据：需项目写角色",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [403] },
    ownerGate: "NOT_DENIED",
    body: { contentOrUri: "矩阵证据", source: "MATRIX", nature: "DEMO" },
  },
  {
    path: "/api/projects/{id}/evidence-gaps",
    method: "GET",
    authz: "证据缺口：项目成员可读",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/projects/{id}/attachments",
    method: "POST",
    authz: "受控附件上传：需项目写角色（授权在解析 multipart 之前）",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [403] },
    /**
     * 本矩阵只发 JSON，而该端点是 multipart 上传口。
     * 断言 415 而不是 NOT_DENIED：415 出现在 `requireProjectRole` **之后**，
     * 所以它同时证明了「门禁已开」与「请求体形态被正确拒绝」。
     * 旧写法是 NOT_DENIED，而当时应用把 formData() 的 TypeError 冒成 500 —— 也是绿的（D-008）。
     */
    ownerGate: [415],
    crossTenant: true,
  },

  // ---------- 项目 ----------
  {
    path: "/api/projects",
    method: "GET",
    authz: "仅返回本组织项目（跨组织必须看不到他组织行）",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    crossTenant: true,
  },
  {
    path: "/api/projects",
    method: "POST",
    authz: "任何组织成员可在自己组织内新建项目（当前无角色门槛，属待拍板口径）",
    expect: { anon: [401], foreign: [201], outsider: [201], viewer: [201] },
    ownerGate: [201],
    body: { title: "矩阵项目探测", target: "矩阵目标", mode: "NEW_PRODUCT" },
    phase: 3,
  },
  {
    path: "/api/projects/{id}",
    method: "GET",
    authz: "项目详情：跨组织 404 不泄露存在性；同组织非成员 403（接口口径）",
    expect: { anon: [401], foreign: [404], outsider: [403], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/projects/{id}",
    method: "PATCH",
    authz: "更新目标/约束：跨组织与非成员同为 404 不泄露存在性",
    expect: { anon: [401], foreign: [404], outsider: [404], viewer: [403] },
    ownerGate: "NOT_DENIED",
    body: { target: "矩阵改后目标", expectedRevision: 1 },
  },
  {
    path: "/api/projects/{id}/feedback",
    method: "POST",
    authz: "反馈：VIEWER 不可提交（A03）；需 OWNER/DECISION_MAKER/FEEDBACK_PROVIDER。已知偏差：跨组织返回 403 而非 404；且为「先校验后鉴权」（validationFirst）",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [403] },
    ownerGate: [201],
    /**
     * targetId 必须带：Feedback.targetId 是无外键的必填 String 列（成果/版本的锚点）。
     * 此前夹具只发 content + targetType，缺 targetId → Prisma 抛 → 500，
     * 而旧门禁把 500 当「门禁已开」放行（D-008）。targetId 非外键，标记串即可。
     * 这里钉死 201：本路由是「先校验后鉴权」，若 body 不完整会先返回 422，
     * 那样即使通过也**不能**证明门禁已开 —— 所以必须给出完整 body。
     */
    body: { content: "矩阵反馈探测", targetType: "PROJECT", targetId: "{{RUN_TAG}}-feedback-target" },
    validationFirst: true,
  },
  {
    path: "/api/projects/{id}/opportunity",
    method: "GET",
    authz: "机会分析：项目成员可读",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/projects/{id}/opportunity",
    method: "PATCH",
    authz: "机会判断覆盖：需项目写角色",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [403] },
    ownerGate: "NOT_DENIED",
    body: {},
  },
  {
    path: "/api/projects/{id}/research-runs",
    method: "GET",
    authz: "研究运行列表：项目成员可读；响应剔除 runnerPid/runnerBootId（B6）",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/projects/{id}/research-runs",
    method: "POST",
    authz: "发起研究：需项目写角色",
    expect: { anon: [401], foreign: "NO_2XX", outsider: "NO_2XX", viewer: "NO_2XX" },
    ownerGate: "NOT_DENIED",
    body: { question: "矩阵研究问题" },
    validationFirst: true,
  },
  {
    path: "/api/research-runs/{runId}",
    method: "GET",
    authz: "研究运行详情：项目成员可读",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/projects/{id}/suggestions",
    method: "GET",
    authz: "产品建议：项目成员可读",
    expect: { anon: [401], foreign: [404], outsider: [403], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/projects/{id}/suggestions",
    method: "POST",
    authz: "生成/采纳建议：需项目写角色",
    expect: { anon: [401], foreign: [404], outsider: [403], viewer: [403] },
    ownerGate: "NOT_DENIED",
    body: {},
  },
  {
    path: "/api/projects/{id}/work-items",
    method: "POST",
    authz: "新建工作项：需项目写角色",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [403] },
    ownerGate: "NOT_DENIED",
    body: { title: "矩阵工作项探测", target: "矩阵目标", deliverableReq: "矩阵交付要求" },
  },
  {
    path: "/api/projects/{id}/decision-packets",
    method: "POST",
    authz: "起草决策包：需项目写角色",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [403] },
    ownerGate: "NOT_DENIED",
    body: {
      budgetAmount: 1000,
      budgetScope: "矩阵范围",
      validationPlan: "矩阵验证计划",
      artifactVersions: [],
      evidenceVersions: [],
    },
  },

  // ---------- 工作项 ----------
  {
    path: "/api/work-items/{id}/reviews",
    method: "POST",
    authz: "验收/退回成果：仅项目 OWNER",
    expect: { anon: [401], foreign: [404], outsider: [403], viewer: [403] },
    ownerGate: "NOT_DENIED",
    body: { accepted: true, reason: "矩阵验收" },
  },
  {
    path: "/api/work-items/{id}/submissions",
    method: "POST",
    authz: "提交成果批次：需项目写角色；关键证据缺口未闭合时阻断（P1-02）",
    expect: { anon: [401], foreign: [404], outsider: [403], viewer: [403] },
    /**
     * 门禁已开用 422 证明，而不是靠一次成功提交。
     *
     * 夹具此前只发 artifacts，没有 inputRevision —— 而 inputRevision 是 RunReceipt 的
     * 必填列，Prisma 抛 PrismaClientValidationError → 500；旧门禁把 500 当成
     * 「门禁已开」放行，于是这条路由的 owner 侧从头到尾没被真正验证过（D-008）。
     *
     * 现取远大于任何夹具 revision 的哨兵值，命中 R09「不得对未来版本提交」校验：
     *   · 该 422 发生在项目角色校验**之后** ⇒ 等价于「门禁已开」；
     *   · 不向 WorkSubmission / RunReceipt / Artifact 写业务数据，矩阵保持只读倾向；
     *   · 提交成功路径由 product-center / b01-r1 套件覆盖，不在此重复。
     */
    ownerGate: [422],
    body: {
      inputRevision: 9999,
      runMode: "MANUAL",
      artifacts: [{ type: "RESEARCH_REPORT", title: "矩阵成果", content: "{}" }],
    },
  },

  // ---------- 产品 ----------
  {
    path: "/api/products",
    method: "GET",
    authz: "仅返回本组织产品（跨组织必须看不到他组织行）",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    crossTenant: true,
  },
  {
    path: "/api/products",
    method: "POST",
    authz: "任何组织成员可在自己组织内建产品（当前无角色门槛，属待拍板口径）",
    expect: { anon: [401], foreign: [201], outsider: [201], viewer: [201] },
    ownerGate: [201],
    body: { name: "矩阵产品探测", identityCode: "{{RUN_TAG}}-{{IDENTITY}}", targetAudience: "矩阵人群", marketPath: "DOMESTIC", devMode: "SELF_DEVELOPED" },
    phase: 3,
  },
  {
    path: "/api/products/ingest",
    method: "POST",
    authz: "产品入库：需组织内有效身份",
    expect: { anon: [401], foreign: "NO_2XX", outsider: "NO_2XX", viewer: "NO_2XX" },
    ownerGate: "NOT_DENIED",
    body: {},
    validationFirst: true,
  },
  {
    path: "/api/products/{id}/versions",
    method: "POST",
    authz: "发布不可变版本：仅产品 OWNER（requireProductRole）",
    expect: { anon: [401], foreign: [404], outsider: [403], viewer: [403] },
    ownerGate: "NOT_DENIED",
    body: { versionTag: "v-matrix", specs: { netWeight: "30 条/盒" } },
  },
  {
    path: "/api/products/{id}/revisions",
    method: "GET",
    authz:
      "产品修订列表：**组织内可读**（2026-09-16 拍板：读=同组织任意成员，写=项目角色）；跨组织仍 404",
    expect: { anon: [401], foreign: [404], outsider: [200], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/products/{id}/revisions",
    method: "POST",
    authz: "创建修订：仅产品 OWNER",
    expect: { anon: [401], foreign: [404], outsider: [403], viewer: [403] },
    ownerGate: "NOT_DENIED",
    body: { title: "矩阵修订", changes: "矩阵变更" },
  },
  {
    path: "/api/products/{id}/revisions/compare",
    method: "GET",
    authz: "修订对比：同上读口径；缺查询参数时先于鉴权返回 400",
    expect: { anon: [401], foreign: "NO_2XX", outsider: "NO_2XX", viewer: "NO_2XX" },
    ownerGate: "NOT_DENIED",
    validationFirst: true,
  },
  {
    path: "/api/products/{id}/analyses",
    method: "POST",
    authz: "产品分析：仅产品 OWNER",
    expect: { anon: [401], foreign: [404], outsider: [403], viewer: [403] },
    ownerGate: "NOT_DENIED",
    body: {},
  },
  {
    path: "/api/products/{id}/launch",
    method: "GET",
    authz: "上市计划读取：组织内可读（产品读口径待拍板）",
    expect: { anon: [401], foreign: [404], outsider: [200], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/products/{id}/launch",
    method: "POST",
    authz: "新增/更新上市计划：需产品写权限",
    expect: { anon: [401], foreign: "NO_2XX", outsider: "NO_2XX", viewer: "NO_2XX" },
    ownerGate: "NOT_DENIED",
    body: { title: "矩阵上市计划探测" },
    validationFirst: true,
  },

  // ---------- 上市计划 ----------
  {
    path: "/api/launch/plans/{planId}",
    method: "PATCH",
    authz: "更新上市计划：需产品写权限",
    expect: { anon: [401], foreign: [404], outsider: [403], viewer: [403] },
    ownerGate: "NOT_DENIED",
    body: { title: "矩阵计划改名" },
  },
  {
    path: "/api/launch/plans/{planId}/approve",
    method: "POST",
    authz: "放行获准（G3）：不得与执行混淆；需产品写权限",
    expect: { anon: [401], foreign: [404], outsider: [403], viewer: [403] },
    ownerGate: "NOT_DENIED",
    body: { note: "矩阵放行探测" },
  },
  {
    path: "/api/launch/plans/{planId}/approve",
    method: "DELETE",
    authz: "撤销获准（必须给原因，缺失先返回 422）",
    expect: { anon: [401], foreign: "NO_2XX", outsider: "NO_2XX", viewer: "NO_2XX" },
    ownerGate: "NOT_DENIED",
    body: { reason: "矩阵撤销探测" },
    validationFirst: true,
  },
  {
    path: "/api/launch/plans/{planId}/launch",
    method: "POST",
    authz: "确认实际上市：需产品写权限；批准≠已上市",
    expect: { anon: [401], foreign: "NO_2XX", outsider: "NO_2XX", viewer: "NO_2XX" },
    ownerGate: "NOT_DENIED",
    body: { actualLaunchedAt: "2026-09-15T00:00:00.000Z" },
    validationFirst: true,
  },
  {
    path: "/api/launch/plans/{planId}/milestones",
    method: "POST",
    authz: "上市里程碑：需产品写权限",
    expect: { anon: [401], foreign: "NO_2XX", outsider: "NO_2XX", viewer: "NO_2XX" },
    ownerGate: "NOT_DENIED",
    body: { title: "矩阵里程碑", dueDate: "2026-10-01T00:00:00.000Z" },
    validationFirst: true,
  },

  // ---------- 反馈处置 ----------
  {
    path: "/api/feedback/{id}/disposition",
    method: "POST",
    authz: "反馈处置（采纳/驳回）：仅项目 OWNER",
    expect: { anon: [401], foreign: [404], outsider: [403], viewer: [403] },
    ownerGate: "NOT_DENIED",
    body: { status: "REJECTED", reason: "矩阵处置" },
  },

  // ---------- 提议 ----------
  {
    path: "/api/proposals",
    method: "GET",
    authz: "仅返回本组织提议（跨组织必须看不到他组织行）",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    crossTenant: true,
  },
  {
    path: "/api/proposals",
    method: "POST",
    authz: "在调用者组织内建提议",
    expect: { anon: [401], foreign: "NO_2XX", outsider: "NO_2XX", viewer: "NO_2XX" },
    ownerGate: "NOT_DENIED",
    body: { actionType: "CREATE_WORK_ITEM", payloadJson: {} },
    validationFirst: true,
  },
  {
    path: "/api/proposals/{id}/confirm",
    method: "POST",
    authz: "确认提议：提议归属校验；跨组织 404 不泄露存在性。夹具提议由 owner 提出，防自确认故 owner 期望被拒",
    expect: { anon: [401], foreign: [404], outsider: "NO_2XX", viewer: "NO_2XX" },
    ownerGate: "NO_2XX",
    body: {},
  },
  {
    path: "/api/proposals/{id}/reject",
    method: "POST",
    authz: "驳回提议：同上，防自驳",
    expect: { anon: [401], foreign: [404], outsider: "NO_2XX", viewer: "NO_2XX" },
    ownerGate: "NO_2XX",
    body: { reason: "矩阵驳回" },
  },

  // ---------- 信号 ----------
  {
    path: "/api/signals",
    method: "GET",
    authz: "仅返回本组织信号（跨组织必须看不到他组织行）",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    crossTenant: true,
  },
  {
    path: "/api/signals",
    method: "POST",
    authz: "人工录入信号：服务层强制写入调用者组织（organizationId 由 session 决定）",
    expect: { anon: [401], foreign: [201], outsider: [201], viewer: [201] },
    ownerGate: [201],
    body: { title: "{{RUN_TAG}}-{{IDENTITY}} 矩阵信号探测", sourceKey: "manual" },
    phase: 3,
  },

  // ---------- 知识 ----------
  {
    path: "/api/knowledge/facts",
    method: "GET",
    authz: "仅返回本组织公司事实（跨组织必须看不到他组织行）",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    crossTenant: true,
  },
  {
    path: "/api/knowledge/facts",
    method: "POST",
    authz: "写入公司事实：需组织管理员（OrganizationMember.role = ORG_ADMIN，不再由项目 OWNER 推断）",
    expect: { anon: [401], foreign: "NO_2XX", outsider: "NO_2XX", viewer: "NO_2XX" },
    ownerGate: "NOT_DENIED",
    body: { fieldKey: "matrix.probe", label: "矩阵探测", value: "x" },
    validationFirst: true,
  },
  {
    path: "/api/knowledge/facts",
    method: "PATCH",
    authz: "确认/更新公司事实：需组织管理员",
    expect: { anon: [401], foreign: "NO_2XX", outsider: "NO_2XX", viewer: "NO_2XX" },
    ownerGate: "NOT_DENIED",
    body: { id: "matrix", fieldKey: "matrix.probe" },
    validationFirst: true,
  },
  {
    path: "/api/knowledge/search",
    method: "GET",
    authz: "知识检索：仅限调用者组织且受控资料范围",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    crossTenant: true,
  },
  {
    path: "/api/knowledge/sources",
    method: "GET",
    authz: "知识源明细：需组织管理员；响应含服务器绝对路径 rootPath，不应对普通成员开放",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [403] },
    ownerGate: [200],
  },
  {
    path: "/api/knowledge/sources",
    method: "POST",
    authz: "新建知识来源：需组织管理员",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [403] },
    ownerGate: "NOT_DENIED",
    body: { name: "矩阵知识源探测", rootPath: "/tmp/matrix-probe" },
  },
  {
    path: "/api/knowledge/sources/{id}/sync",
    method: "POST",
    authz: "同步知识源：需组织管理员；跨组织对不存在资源返回 404，非管理员先触发校验",
    expect: { anon: [401], foreign: "NO_2XX", outsider: "NO_2XX", viewer: "NO_2XX" },
    ownerGate: "NOT_DENIED",
    body: {},
    validationFirst: true,
  },
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
