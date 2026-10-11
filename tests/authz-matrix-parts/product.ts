import type { RouteSpec } from "../authz-matrix";

/**
 * 权限矩阵分域：产品域：产品 / 上市计划
 * 聚合入口见 tests/authz-matrix.ts；条目顺序与拆分前保持一致。
 * 新增路由时请追加到对应分域文件末尾，不要改聚合文件。
 */
export const PRODUCT_SPECS: RouteSpec[] = [
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
];
