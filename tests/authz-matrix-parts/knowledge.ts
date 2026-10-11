import type { RouteSpec } from "../authz-matrix";

/**
 * 权限矩阵分域：知识域：反馈处置 / 提议 / 信号 / 知识库 / 顾问运行 / 模型控制
 * 聚合入口见 tests/authz-matrix.ts；条目顺序与拆分前保持一致。
 * 新增路由时请追加到对应分域文件末尾，不要改聚合文件。
 */
export const KNOWLEDGE_SPECS: RouteSpec[] = [
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
    path: "/api/knowledge/synthesize",
    method: "POST",
    authz:
      "Knowledge Router + 综合（KX-73）：只读检索，各 provider 按调用方组织隔离；只有给了 projectId 且具备证据写入权限才写 Evidence——本探测不带 projectId，因此对任何登录身份都是纯读",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    body: { query: "矩阵探测", bindEvidence: false },
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

  // ---------- 顾问交互运行 ----------
  {
    path: "/api/agent-runs",
    method: "POST",
    authz: "创建交互式运行：登录即可在本组织建 QUEUED 运行；跨组织不得写入他组织",
    expect: { anon: [401], foreign: [201], outsider: [201], viewer: [201] },
    ownerGate: [201],
    body: { purpose: "ADVISOR_MESSAGE" },
    phase: 3,
  },
  {
    path: "/api/agent-runs/{runId}",
    method: "GET",
    authz: "运行状态：同组织可读（不校验发起人）；跨组织 404 不泄露存在性",
    expect: { anon: [401], foreign: [404], outsider: [200], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/agent-runs/{runId}/cancel",
    method: "POST",
    authz: "取消运行：仅发起人；跨组织 404，同组织非发起人 403",
    expect: { anon: [401], foreign: [404], outsider: [403], viewer: [403] },
    ownerGate: [200],
  },

  // ---------- 模型控制中心 ----------
  {
    path: "/api/model-control",
    method: "GET",
    authz: "模型控制总览：登录即可读（canManage 标记区分管理入口）；数据按组织隔离",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    crossTenant: true,
  },
  {
    path: "/api/model-control",
    method: "POST",
    authz: "安装模型控制预设：仅组织管理员（OrganizationMember.role = ORG_ADMIN）",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [403] },
    ownerGate: [201],
    body: { action: "INSTALL_PRESETS" },
  },
];
