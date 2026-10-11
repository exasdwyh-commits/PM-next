import type { RouteSpec } from "../authz-matrix";

/**
 * 权限矩阵分域：V2 补登记（2026-10-09）：assistant / billing / feedback / desktop / harness / kern / research
 * 聚合入口见 tests/authz-matrix.ts；条目顺序与拆分前保持一致。
 * 新增路由时请追加到对应分域文件末尾，不要改聚合文件。
 */
export const V2_SPECS: RouteSpec[] = [
  // ==========================================================================
  // V2 补登记（2026-10-09）
  // ==========================================================================
  //
  // 为什么现在才登记：V2 交付（feat/v2-full-closure）新增了 23 条 API 路由 /
  // 42 个方法，但 `tests/authz-matrix.ts` 未同步——`tests/authz-route-coverage.test.ts`
  // 的 AC1 因此在 V2 分支上失败，且 `acceptance-authz-matrix` 的 1.1/1.3/1.4 基线
  // 也随之失配。换句话说：**这批新接口的权限行为此前完全没有回归覆盖**。
  // 本节把缺口补齐，并对每条都写清鉴权口径。
  //
  // 本节各条的口径来源（逐条读过 route 实现，不是按命名推断）：
  // - 绝大部分路由体是 `getServerSession(req)` 在 try 内的第一句，未登录抛
  //   UnauthorizedError → 401；此后一律只用 `session.organizationId` 过滤，
  //   不再做项目级角色门禁。因此**跨组织/同组织非成员只要登录就是 200**，
  //   隔离靠「查询限定 organizationId」而非状态码——这正是 crossTenant 用例存在的理由。
  // - 少数路由在鉴权**之前**先校验必填参数（`if (!x) throw/return`），
  //   这类记 validationFirst，任何身份都先吃 422/400，门禁实际未被测到。
  //
  // 归属说明：`/api/feedback`、`/api/kern/dispatch` 不属 V2 新增源码
  // （前者在 main 上已存在，只是矩阵一直漏登记），但既已纳入同一次覆盖修复，
  // 一并登记以免留下第二批幽灵缺口。

  // ---------- 成本情景（CostScenario，组织级共享资产） ----------
  {
    path: "/api/cost/scenarios",
    method: "GET",
    authz: "成本情景列表：登录后按 organizationId 过滤，同组织任何成员可读；跨组织读到空集合",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    crossTenant: true,
  },
  {
    path: "/api/cost/scenarios",
    method: "POST",
    authz: "新建成本情景：先校验 name/productName 与 category 白名单，缺字段 400 先于任何角色判断（validationFirst）",
    expect: { anon: [401], foreign: [400], outsider: [400], viewer: [400] },
    ownerGate: [400],
    body: {},
    validationFirst: true,
    phase: 3,
  },
  {
    path: "/api/cost/scenarios/{id}",
    method: "GET",
    authz: "成本情景详情：id + organizationId 双限定，跨组织查不到 404，不泄露存在性",
    expect: { anon: [401], foreign: [404], outsider: [404], viewer: [404] },
    ownerGate: [404],
  },
  {
    path: "/api/cost/scenarios/{id}",
    method: "PUT",
    authz: "更新成本情景（自动落一个版本）：同上双限定，跨组织 404",
    expect: { anon: [401], foreign: [404], outsider: [404], viewer: [404] },
    ownerGate: [404],
    body: { name: "矩阵探测改名" },
  },
  {
    path: "/api/cost/scenarios/{id}",
    method: "DELETE",
    authz: "删除成本情景：同上双限定，跨组织 404（不会误删他人资产）",
    expect: { anon: [401], foreign: [404], outsider: [404], viewer: [404] },
    ownerGate: [404],
  },
  {
    path: "/api/cost/scenarios/{id}/approval",
    method: "POST",
    authz: "提交审批：先查 scenario 是否属本组织（跨组织 404），再建审批单",
    expect: { anon: [401], foreign: [404], outsider: [404], viewer: [404] },
    ownerGate: [404],
    body: {},
    phase: 3,
  },
  {
    path: "/api/cost/scenarios/{id}/approval",
    method: "PUT",
    authz: "审批裁决：先校验 approvalId/status 与状态白名单，缺字段 400；且审批单须属本组织",
    expect: { anon: [401], foreign: [400], outsider: [400], viewer: [400] },
    ownerGate: [400],
    body: {},
    validationFirst: true,
  },
  {
    path: "/api/cost/scenarios/{id}/approval",
    method: "GET",
    authz: "审批单列表：先确认 scenario 属本组织，跨组织 404",
    expect: { anon: [401], foreign: [404], outsider: [404], viewer: [404] },
    ownerGate: [404],
  },
  {
    path: "/api/cost/scenarios/{id}/comments",
    method: "GET",
    authz: "情景评论列表：先确认 scenario 属本组织，跨组织 404",
    expect: { anon: [401], foreign: [404], outsider: [404], viewer: [404] },
    ownerGate: [404],
  },
  {
    path: "/api/cost/scenarios/{id}/comments",
    method: "POST",
    authz: "发表评论：先确认 scenario 属本组织，跨组织 404",
    expect: { anon: [401], foreign: [404], outsider: [404], viewer: [404] },
    ownerGate: [404],
    body: { content: "矩阵探测评论" },
    phase: 3,
  },
  {
    path: "/api/cost/scenarios/{id}/versions",
    method: "GET",
    authz: "版本历史：先确认 scenario 属本组织，跨组织 404",
    expect: { anon: [401], foreign: [404], outsider: [404], viewer: [404] },
    ownerGate: [404],
  },
  {
    path: "/api/cost/scenarios/{id}/versions",
    method: "POST",
    authz: "回滚到指定版本：先确认 scenario 属本组织，跨组织 404",
    expect: { anon: [401], foreign: [404], outsider: [404], viewer: [404] },
    ownerGate: [404],
    body: { version: 1 },
    phase: 3,
  },
  {
    path: "/api/cost/scenarios/compare",
    method: "POST",
    authz: "情景对比：body 里的 id 可能来自他人组织，实现只按本组织取数（他人 id 视为不存在），不接受跨组织读取",
    expect: { anon: [401], foreign: [400], outsider: [400], viewer: [400] },
    ownerGate: [400],
    body: {},
    validationFirst: true,
  },

  // ---------- 助手能力（用户自作用域：organizationId + userId 双限定） ----------
  {
    path: "/api/assistant/active-push",
    method: "GET",
    authz: "主动推送：记忆查询按 organizationId + userId 双限定，任何登录用户只可能读到自己的记忆",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    crossTenant: true,
  },
  {
    path: "/api/assistant/active-push",
    method: "POST",
    authz: "同上，走 POST 变体；记忆范围不变",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    crossTenant: true,
  },
  {
    path: "/api/assistant/active-push",
    method: "PUT",
    authz:
      "读取 cron 配置描述（纯静态文本）：虽不含租户数据，但仍须登录，与同文件 GET/POST 口径一致（已补 getServerSession）",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/assistant/daily-briefing",
    method: "GET",
    authz: "每日简报：只读本人未遗忘记忆（organizationId + userId + forgottenAt: null）",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    crossTenant: true,
  },
  {
    path: "/api/assistant/daily-briefing",
    method: "POST",
    authz: "同上，POST 变体；记忆范围不变",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    crossTenant: true,
  },
  {
    path: "/api/assistant/marketing-landing",
    method: "GET",
    authz: "营销落地页生成：入参只有 query 文本，无租户数据读取，任何登录用户可调用",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/assistant/marketing-landing",
    method: "POST",
    authz: "同上，POST 变体",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/assistant/project-tracking",
    method: "GET",
    authz: "项目跟踪：缺 projectId 时 400 先于任何归属判断（validationFirst），因此门禁未被测到",
    expect: { anon: [401], foreign: [400], outsider: [400], viewer: [400] },
    ownerGate: [400],
    validationFirst: true,
  },
  {
    path: "/api/assistant/project-tracking",
    method: "POST",
    authz: "同上，缺 projectId 时 400；注意 projectId 归属校验在能力内部，非本路由直接表达",
    expect: { anon: [401], foreign: [400], outsider: [400], viewer: [400] },
    ownerGate: [400],
    body: {},
    validationFirst: true,
  },

  // ---------- 计费（组织级只读） ----------
  {
    path: "/api/billing",
    method: "GET",
    authz: "用量总览：按 organizationId 聚合，同组织任何成员可读；跨组织读到自己的（可能为 0）",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    crossTenant: true,
  },

  // ---------- 反馈（组织 + 用户自作用域） ----------
  {
    path: "/api/feedback",
    method: "GET",
    authz: "反馈 / 记忆 / Harness 样本列表：三者均按 organizationId + userId 限定，只读本人数据",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    crossTenant: true,
  },
  {
    path: "/api/feedback",
    method: "POST",
    authz: "提交反馈：先校验 body.type，缺失 422 先于任何归属判断（validationFirst）",
    expect: { anon: [401], foreign: [422], outsider: [422], viewer: [422] },
    ownerGate: [422],
    body: {},
    validationFirst: true,
    phase: 3,
  },
  {
    path: "/api/feedback",
    method: "PUT",
    authz: "评测 Harness 样本：先校验 sampleId/actual/outcome，缺失 422（validationFirst）",
    expect: { anon: [401], foreign: [422], outsider: [422], viewer: [422] },
    ownerGate: [422],
    body: {},
    validationFirst: true,
  },

  // ---------- 本机动作 / 内核调度 / Harness 校验（描述型只读） ----------
  {
    path: "/api/desktop/action",
    method: "GET",
    authz:
      "本机动作运行时描述（静态能力清单）：仍须登录，与同文件 POST 口径一致（已补 getServerSession）",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/desktop/action",
    method: "POST",
    authz: "执行本机动作：先校验 body.type，缺失 422 先于动作执行（validationFirst）",
    expect: { anon: [401], foreign: [422], outsider: [422], viewer: [422] },
    ownerGate: [422],
    body: {},
    validationFirst: true,
  },
  {
    path: "/api/harness/validate",
    method: "GET",
    authz:
      "Harness R1-R17 校验（固定样例的自检）：须登录，与同文件 POST 口径一致（已补 getServerSession）",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/harness/validate",
    method: "POST",
    authz:
      "Harness 校验（按传入报告内容评分）：须登录——本接口接受调用方传入 htmlReport/richReport/costData，属可被消耗的计算面（已补 getServerSession）",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    body: { category: "health_food", role: "product" },
  },
  {
    path: "/api/kern/dispatch",
    method: "GET",
    authz: "内核调度提示词（静态提示词文本 + query 上下文）：需登录，但不读任何租户数据",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/kern/dispatch",
    method: "POST",
    authz: "调度提示词生成：先校验 body.goal，缺失 400 先于任何判断（validationFirst）",
    expect: { anon: [401], foreign: [400], outsider: [400], viewer: [400] },
    ownerGate: [400],
    body: {},
    validationFirst: true,
  },
  {
    path: "/api/memory/role",
    method: "GET",
    authz: "角色偏好读取：只读当前用户自己的偏好记忆",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    crossTenant: true,
  },
  {
    path: "/api/memory/role",
    method: "POST",
    authz: "记住角色偏好：先校验 role 是否在 leadership/product/sales 白名单，非法 422（validationFirst）",
    expect: { anon: [401], foreign: [422], outsider: [422], viewer: [422] },
    ownerGate: [422],
    body: {},
    validationFirst: true,
    phase: 3,
  },
  {
    path: "/api/memory/role",
    method: "DELETE",
    authz: "清除角色偏好：只删当前用户自己匹配到的偏好记忆，不影响他人",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
  },

  // ---------- 产品研发做法 / Worker 状态 ----------
  {
    path: "/api/playbook/new-product",
    method: "GET",
    authz: "新品做法描述（静态 DAG 文本）：仍须登录，与同文件写入口径一致（已补 getServerSession）",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/playbook/new-product",
    method: "POST",
    authz: "执行新品做法：先校验 body.productIdea，缺失 422（validationFirst）；真正归属校验在做法内部",
    expect: { anon: [401], foreign: [422], outsider: [422], viewer: [422] },
    ownerGate: [422],
    body: {},
    validationFirst: true,
  },
  {
    path: "/api/worker/status",
    method: "GET",
    authz: "Worker 状态与队列：按 organizationId 读心跳与任务，跨组织读到自己的空队列",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    crossTenant: true,
  },

  // ---------- 研究：抓取 / 验证 ----------
  {
    path: "/api/research/fetch",
    method: "GET",
    authz: "抓取器描述（静态能力 / 信任分档文本）：仍须登录，与同文件 POST 口径一致（已补 getServerSession）",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/research/fetch",
    method: "POST",
    authz: "抓取来源：先校验 body.url，缺失 422；随后过成本闸（超限 429），再按本组织落 SourceCapture",
    expect: { anon: [401], foreign: [422], outsider: [422], viewer: [422] },
    ownerGate: [422],
    body: {},
    validationFirst: true,
  },
  {
    path: "/api/research/verify",
    method: "GET",
    authz: "验证器描述（静态能力文本）：仍须登录，与同文件 POST 口径一致（已补 getServerSession）",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/research/verify",
    method: "POST",
    authz: "验证证据：先校验 claim/sourceId，缺失 422；sourceId 必须属本组织，跨组织源 404",
    expect: { anon: [401], foreign: [422], outsider: [422], viewer: [422] },
    ownerGate: [422],
    body: {},
    validationFirst: true,
  },
];
