import type { RouteSpec } from "../authz-matrix";

/**
 * 权限矩阵分域：成本域：渠道路线 / 成本情景 / 生产门禁
 * 聚合入口见 tests/authz-matrix.ts；条目顺序与拆分前保持一致。
 * 新增路由时请追加到对应分域文件末尾，不要改聚合文件。
 */
export const COST_SPECS: RouteSpec[] = [
  // ---------- 渠道路线 ----------
  {
    path: "/api/products/{id}/channel-routes",
    method: "GET",
    authz: "渠道路线工作台：产品读口径（同组织可读）；跨组织 404",
    expect: { anon: [401], foreign: [404], outsider: [200], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/products/{id}/channel-routes",
    method: "POST",
    authz: "CREATE_RULE：渠道规则属组织级资产，仅组织管理员；非管理员 403 先于字段校验",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [403] },
    ownerGate: [422],
    body: { action: "CREATE_RULE" },
  },

  // ---------- 成本情景 ----------
  {
    path: "/api/products/{id}/cost-scenarios",
    method: "GET",
    authz: "成本情景列表：产品读口径（同组织可读）；跨组织 404",
    expect: { anon: [401], foreign: [404], outsider: [200], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/products/{id}/cost-scenarios",
    method: "POST",
    authz: "保存成本情景：需产品写角色（OWNER/DECISION_MAKER）；空 body 在门禁之后 422",
    expect: { anon: [401], foreign: [404], outsider: [403], viewer: [403] },
    ownerGate: [422],
    body: {},
  },

  // ---------- 生产门禁（G2 / 开工 / 交付） ----------
  {
    path: "/api/projects/{id}/production",
    method: "GET",
    authz: "生产上下文：项目成员可读；先 requireProjectRole 再 assertProjectVisible",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [200] },
    ownerGate: [200],
  },
  {
    path: "/api/projects/{id}/production/prepare",
    method: "POST",
    authz: "整理生产决策材料：仅项目 OWNER；阶段门禁在角色校验之后",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [403] },
    ownerGate: "NOT_DENIED",
  },
  {
    path: "/api/projects/{id}/production/g2",
    method: "POST",
    authz: "正式 G2 报批：仅项目 OWNER；缺材料时 409/422 属门禁已开",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [403] },
    ownerGate: "NOT_DENIED",
  },
  {
    path: "/api/projects/{id}/production/start",
    method: "POST",
    authz: "确认开工：note 校验先于 requireProjectRole（validationFirst）；带 note 后仅 OWNER 过门",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [403] },
    ownerGate: "NOT_DENIED",
    body: { note: "矩阵开工探测" },
    validationFirst: true,
  },
  {
    path: "/api/projects/{id}/production/deliver",
    method: "POST",
    authz: "确认交付：note 校验先于 requireProjectRole（validationFirst）；带 note 后仅 OWNER 过门",
    expect: { anon: [401], foreign: [403], outsider: [403], viewer: [403] },
    ownerGate: "NOT_DENIED",
    body: { note: "矩阵交付探测" },
    validationFirst: true,
  },
];
