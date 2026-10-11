import type { RouteSpec } from "../authz-matrix";

/**
 * 权限矩阵分域：项目域：项目 / 工作项（含 product-rnd、reports 报告）
 * 聚合入口见 tests/authz-matrix.ts；条目顺序与拆分前保持一致。
 * 新增路由时请追加到对应分域文件末尾，不要改聚合文件。
 */
export const PROJECT_SPECS: RouteSpec[] = [
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
    /**
     * 该路由的 `workItemId` 是**必填查询参数**，而路由在鉴权之前先做了参数非空校验。
     * 若矩阵不带参数，所有登录身份都会被 422 抢先拦下，等于门禁完全没被测到。
     * 因此用 `query` 带一个不存在的探针 id，让 `requireProjectRole` 真正执行：
     * - 未授权身份拿到 403（requireProjectRole 只抛 Forbidden）
     * - viewer 门禁已开，但探针 workItemId 不存在 → 404
     * `query` 不参与路由登记比对，所以 path 仍是裸模板。
     */
    path: "/api/projects/{id}/product-rnd",
    method: "GET",
    authz: "产品研发状态：须 OWNER/DECISION_MAKER/VIEWER；带探针 workItemId 以让门禁先于参数校验生效",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [404] },
    ownerGate: [404],
    query: "workItemId=matrix-probe",
  },
  {
    /**
     * 发合法 brief（而不是空 body），否则 `brief is required` 的 422 会先于门禁返回，
     * 矩阵就测不到"仅 OWNER"这条规则。会真实新建 WorkItem + 五路任务，故排 phase 3。
     */
    path: "/api/projects/{id}/product-rnd",
    method: "POST",
    authz: "启动产品研发：仅项目 OWNER；matrix 用合法 brief 确保走到 requireProjectRole",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [403] },
    ownerGate: "NOT_DENIED",
    body: { action: "START", brief: "矩阵回归：产品研发启动" },
    phase: 3,
  },
  {
    path: "/api/reports/{id}",
    method: "GET",
    authz: "Executive Report HTML 页数据：项目成员可读（OWNER/DECISION_MAKER/VIEWER）",
    // foreign 是 **404** 而不是 403（2026-10-11 实测校正）：report-view.ts 先按
    // `organizationId` 过滤再判项目成员，跨组织查不到任何行 → null → 404，不泄露跨组织存在性；
    // 只有**同组织非成员**才会走到 requireProjectRole 抛 ForbiddenError → 403。
    // 与 artifacts/{id}、connectors/{id}、schedules/{id}、playbooks/{id} 等同类路由一致。
    expect: { anon: [401], foreign: [404], outsider: [403], viewer: [200] },
    ownerGate: "NOT_DENIED",
    phase: 1,
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
];
