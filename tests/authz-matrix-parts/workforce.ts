import type { RouteSpec } from "../authz-matrix";

/**
 * 权限矩阵分域：数字员工域：Workforce
 * 聚合入口见 tests/authz-matrix.ts；条目顺序与拆分前保持一致。
 * 新增路由时请追加到对应分域文件末尾，不要改聚合文件。
 */
export const WORKFORCE_SPECS: RouteSpec[] = [
  // ---------- 数字员工（Workforce） ----------
  {
    path: "/api/workforce/studio",
    method: "GET",
    authz: "员工工作室：登录后按组织、员工可见性、任务创建者或运行所有者过滤；组织管理员可查看本组织工作",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    crossTenant: true,
  },
  {
    path: "/api/workforce",
    method: "GET",
    authz: "数字员工总览：登录即可读（按组织与可见性过滤）；数据按组织隔离",
    expect: { anon: [401], foreign: [200], outsider: [200], viewer: [200] },
    ownerGate: [200],
    crossTenant: true,
  },
  {
    path: "/api/workforce/bootstrap",
    method: "POST",
    authz: "引导默认数字员工：仅组织管理员",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [403] },
    ownerGate: [201],
  },
  {
    path: "/api/workforce/tasks",
    method: "POST",
    authz: "创建数字员工任务：登录后先校验 body；缺 agentId/goal 在鉴权结论前 422",
    expect: { anon: [401], foreign: [422], outsider: [422], viewer: [422] },
    ownerGate: [422],
    body: {},
    validationFirst: true,
  },
  {
    path: "/api/workforce/tasks/{id}/start",
    method: "POST",
    authz: "启动任务：跨组织 404；OWNER_ONLY 数字员工非 owner 不可见（404）；owner 可启动 QUEUED",
    expect: { anon: [401], foreign: [404], outsider: [404], viewer: [404] },
    ownerGate: [200],
  },
  {
    path: "/api/workforce/tasks/{id}/delegate",
    method: "POST",
    authz: "委派任务：先校验 body（toAgentId/goal/reason），缺字段 422",
    expect: { anon: [401], foreign: [422], outsider: [422], viewer: [422] },
    ownerGate: [422],
    body: {},
    validationFirst: true,
  },
  {
    path: "/api/workforce/tasks/{id}/finish",
    method: "POST",
    authz: "结束任务：先校验 body（runId/outcome），缺字段 422",
    expect: { anon: [401], foreign: [422], outsider: [422], viewer: [422] },
    ownerGate: [422],
    body: {},
    validationFirst: true,
  },
  {
    path: "/api/workforce/tasks/{id}/review-return",
    method: "POST",
    authz: "审查返回子任务：先校验 body（action），缺/非法 422",
    expect: { anon: [401], foreign: [422], outsider: [422], viewer: [422] },
    ownerGate: [422],
    body: {},
    validationFirst: true,
  },
];
