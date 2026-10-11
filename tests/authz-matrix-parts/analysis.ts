import type { RouteSpec } from "../authz-matrix";

/**
 * 权限矩阵分域：分析域：决策包 / 证据
 * 聚合入口见 tests/authz-matrix.ts；条目顺序与拆分前保持一致。
 * 新增路由时请追加到对应分域文件末尾，不要改聚合文件。
 */
export const ANALYSIS_SPECS: RouteSpec[] = [
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
];
