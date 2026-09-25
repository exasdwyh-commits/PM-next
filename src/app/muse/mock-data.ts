/**
 * 纯前端演示数据。后端接入时删掉本文件，改由 `src/modules/*` 提供同形状视图模型。
 * 刻意保留 unknown / 失败 / 空态样本，避免只做「一切顺利」的假页面。
 */
import type { StudioModel, Employee, Mission, Decision, EvidenceRef, Message } from "./types";

const ev = (o: Partial<EvidenceRef> & { id: string; title: string }): EvidenceRef => ({
  kind: "internal",
  source: "HERMES 内部记录",
  confidence: "medium",
  verified: false,
  capturedAt: "今天 09:12",
  ...o,
});

const employees: Employee[] = [
  { id: "e-hermes", name: "Hermes", role: "部门助理 / PM", mark: "H", state: "working", currentFocus: "汇总三条产品线的本周阻塞点", load: 62, skills: ["拆解", "委派", "汇报"] },
  { id: "e-market", name: "Iris", role: "市场研究", mark: "I", state: "working", currentFocus: "抓取竞品 12 款低GI代餐配料表", load: 78, skills: ["竞品", "价格带", "渠道"] },
  { id: "e-science", name: "Bohr", role: "科学证据", mark: "B", state: "needs-review", currentFocus: "3 篇文献结论互斥，等你选口径", load: 40, skills: ["文献", "剂量", "机制"] },
  { id: "e-formula", name: "Fern", role: "配方", mark: "F", state: "idle", currentFocus: null, load: 0, skills: ["配比", "感官", "工艺"] },
  { id: "e-compliance", name: "Lex", role: "合规", mark: "L", state: "success", currentFocus: null, load: 12, skills: ["标签", "宣称", "法规"] },
  { id: "e-cost", name: "Coin", role: "成本 / BOM", mark: "C", state: "error", currentFocus: "供应商报价接口 401，已停止重试", load: 8, skills: ["BOM", "报价", "毛利"] },
  { id: "e-qa", name: "Vera", role: "独立 QA", mark: "V", state: "working", currentFocus: "复核 Iris 的 9 条竞品数据来源", load: 55, skills: ["核验", "反证", "判定"] },
  { id: "e-desktop", name: "Atlas", role: "本机执行", mark: "A", state: "idle", currentFocus: null, load: 0, skills: ["文件", "终端", "Git"] },
];

const missions: Mission[] = [
  {
    id: "m-1", title: "低GI代餐棒 · 上市前证据补齐", goal: "把 G2 缺的 3 类证据补到可评审状态",
    state: "working", productId: "p-1", productName: "低GI代餐棒", ownerId: "e-hermes",
    startedAt: "今天 08:40", progress: 64,
    steps: [
      { id: "s1", title: "竞品配料与价格带扫描", ownerId: "e-market", state: "success", detail: "12 款已入库，均带来源链接" },
      { id: "s2", title: "血糖负荷宣称的文献支撑", ownerId: "e-science", state: "needs-review", detail: "3 篇结论互斥，需选定口径", awaitsDecision: true },
      { id: "s3", title: "标签宣称合规预检", ownerId: "e-compliance", state: "success" },
      { id: "s4", title: "BOM 成本重算", ownerId: "e-cost", state: "error", detail: "供应商报价接口 401" },
      { id: "s5", title: "独立 QA 复核", ownerId: "e-qa", state: "working" },
    ],
    evidence: [
      ev({ id: "ref-1", title: "竞品配料表扫描（12 款）", verified: true, confidence: "high", source: "公开电商详情页 · 2026-09" }),
      ev({ id: "ref-2", title: "低GI 宣称文献集（3 篇）", kind: "literature", confidence: "unknown", source: "PubMed", excerpt: "两项 RCT 与一项队列研究在终点指标上不可比。" }),
    ],
  },
  {
    id: "m-2", title: "高蛋白早餐杯 · 机会验证", goal: "判断是否值得立项",
    state: "needs-review", productId: null, productName: null, ownerId: "e-market",
    startedAt: "昨天 17:05", progress: null,
    steps: [
      { id: "s6", title: "需求信号归集", ownerId: "e-market", state: "success" },
      { id: "s7", title: "市场容量估算", ownerId: "e-market", state: "needs-review", detail: "缺 2024 后的渠道数据，容量维持 UNKNOWN", awaitsDecision: true },
    ],
    evidence: [ev({ id: "ref-3", title: "渠道容量数据缺口说明", confidence: "unknown", source: "内部研究记录" })],
  },
  {
    id: "m-3", title: "周报 · 三条产品线进度", goal: "生成管理层周报",
    state: "success", productId: null, productName: null, ownerId: "e-hermes",
    startedAt: "今天 07:30", progress: 100, steps: [], evidence: [],
  },
];

const decisions: Decision[] = [
  {
    id: "d-1", title: "低GI 宣称用哪个口径", because: "3 篇文献终点指标不可比，Bohr 不替你选口径。",
    ifIgnored: "G2 证据评审无法通过，上市评审停在闸口。", tone: "block", gate: "G2 生产闸口", missionId: "m-1",
    dueLabel: "今天需处理", raisedBy: "Bohr · 科学证据",
    options: [
      { id: "o1", label: "采用 RCT 口径（更保守）", kind: "approve", hint: "宣称范围收窄，合规风险低" },
      { id: "o2", label: "采用队列研究口径", kind: "approve", hint: "宣称更强，需补充免责说明" },
      { id: "o3", label: "退回：先补一项自有实验", kind: "revise" },
    ],
    evidence: [ev({ id: "ref-2", title: "低GI 宣称文献集（3 篇）", kind: "literature", confidence: "unknown", source: "PubMed" })],
  },
  {
    id: "d-2", title: "批准 Hermes 修改产品字段", because: "助理提出把「目标人群」从泛人群改为血糖管理人群，业务事实修改必须经你批准。",
    ifIgnored: "提议挂起，后续研究继续按旧人群口径跑，可能白做。", tone: "warn", gate: "Proposal / Approval", missionId: "m-1",
    dueLabel: "48 小时内", raisedBy: "Hermes · 部门助理",
    options: [
      { id: "o4", label: "批准写入", kind: "approve" },
      { id: "o5", label: "驳回", kind: "reject" },
      { id: "o6", label: "稍后再说", kind: "defer" },
    ],
    evidence: [ev({ id: "ref-1", title: "竞品人群定位对比", verified: true, confidence: "high" })],
  },
  {
    id: "d-3", title: "供应商报价接口凭据已失效", because: "Coin 连续 3 次 401 后按策略停止重试，没有自行更换凭据。",
    ifIgnored: "BOM 成本维持上月快照，毛利结论不可信。", tone: "warn", gate: null, missionId: "m-1",
    dueLabel: "阻塞中", raisedBy: "Coin · 成本",
    options: [
      { id: "o7", label: "我去更新凭据", kind: "approve" },
      { id: "o8", label: "本轮用上月快照（标记为低置信）", kind: "revise" },
    ],
    evidence: [],
  },
];

const messages: Message[] = [
  {
    id: "msg-1", author: "user", at: "09:02", state: "success",
    blocks: [{ kind: "text", text: "低GI代餐棒这周能不能过 G2？缺什么你直接安排。" }],
  },
  {
    id: "msg-2", author: "hermes", byEmployeeId: "e-hermes", at: "09:02", state: "success",
    blocks: [
      { kind: "text", text: "按 G2 清单核对，缺 3 类证据。我已经把能自动跑的派下去了，两件需要你拍板。" },
      { kind: "plan", title: "本轮拆解", steps: missions[0].steps },
    ],
  },
  {
    id: "msg-3", author: "hermes", byEmployeeId: "e-market", at: "09:18", state: "success",
    blocks: [
      { kind: "text", text: "竞品扫描完成。12 款全部带来源链接，Vera 正在独立复核。" },
      { kind: "evidence", title: "新增证据", refs: missions[0].evidence },
    ],
  },
  {
    id: "msg-4", author: "hermes", byEmployeeId: "e-science", at: "09:31", state: "needs-review",
    blocks: [
      { kind: "unknown", question: "低GI 宣称用哪个口径？", missing: ["三篇文献终点指标不可比", "缺自有实验数据", "宣称强度与合规风险互斥"] },
    ],
  },
  {
    id: "msg-5", author: "hermes", byEmployeeId: "e-hermes", at: "09:33", state: "needs-review",
    blocks: [
      { kind: "proposal", title: "受控提议 · 需批准后写入", summary: "把产品目标人群收窄，使后续研究口径一致。",
        diff: [{ field: "目标人群", from: "泛健康人群", to: "血糖管理人群（25-45）" }, { field: "核心宣称", from: "低糖", to: "低血糖负荷" }] },
    ],
  },
  {
    id: "msg-6", author: "hermes", byEmployeeId: "e-desktop", at: "09:40", state: "success",
    blocks: [
      { kind: "runtime", title: "本机执行 · 导出评审包", command: "hermes export --gate G2 --out ~/Desktop/G2-review", state: "success",
        output: "wrote 14 files (2.3 MB)\n→ ~/Desktop/G2-review/index.html" },
    ],
  },
  {
    id: "msg-7", author: "hermes", byEmployeeId: "e-cost", at: "09:44", state: "error",
    blocks: [
      { kind: "text", text: "BOM 重算失败：供应商报价接口返回 401。已按策略停止重试，不用旧数据冒充新结论。" },
      { kind: "verdict", title: "独立 QA 判定", verdict: "unknown", notes: ["成本结论本轮不可用", "毛利区间维持 UNKNOWN", "需要人更新凭据后重跑"] },
    ],
  },
];

export const studioModel: StudioModel = {
  activeMissionId: null,
  managementHref: "/manage",
  newConversationProduct: null,
  initialDraft: "",
  user: { name: "你", role: "产品负责人", org: "Hermes 食品研发部" },
  brief: {
    greeting: "上午好",
    decisions,
    missions,
    suggestions: [
      { id: "g1", title: "把高蛋白早餐杯推进到立项评估", why: "需求信号已归集，缺容量口径", prompt: "评估高蛋白早餐杯是否值得立项，缺数据就标 UNKNOWN 并告诉我怎么补" },
      { id: "g2", title: "让 Vera 复核上周全部结论", why: "上周有 9 条结论未过独立 QA", prompt: "让独立 QA 复核上周所有新增结论，列出不可信项" },
      { id: "g3", title: "生成给老板的月度部门报告", why: "上次报告是 3 周前", prompt: "生成本月部门报告：进展、阻塞、下月需要的决策" },
    ],
  },
  employees,
  messages,
  activity: [
    { id: "a1", at: "09:44", state: "error", actorId: "e-cost", text: "BOM 重算失败 · 供应商接口 401", missionId: "m-1" },
    { id: "a2", at: "09:40", state: "success", actorId: "e-desktop", text: "本机导出 G2 评审包 · 14 个文件", missionId: "m-1" },
    { id: "a3", at: "09:33", state: "needs-review", actorId: "e-hermes", text: "提交受控提议 · 等你批准", missionId: "m-1" },
    { id: "a4", at: "09:31", state: "needs-review", actorId: "e-science", text: "文献口径互斥 · 升级为决策", missionId: "m-1" },
    { id: "a5", at: "09:22", state: "working", actorId: "e-qa", text: "独立复核 9 条竞品数据", missionId: "m-1" },
    { id: "a6", at: "09:18", state: "success", actorId: "e-market", text: "竞品扫描完成 · 12 款入库", missionId: "m-1" },
    { id: "a7", at: "07:30", state: "success", actorId: "e-hermes", text: "生成三线周报", missionId: "m-3" },
  ],
  runtime: {
    connected: true, host: "MacBook Pro · exasdwyh", lastHeartbeat: "12 秒前",
    capabilities: ["文件", "终端", "Git", "浏览器", "剪贴板", "通知", "本机 Agent"],
    activeAction: null,
  },
  evidence: [
    ev({ id: "ref-1", title: "竞品配料表扫描（12 款）", verified: true, confidence: "high", source: "公开电商详情页 · 2026-09" }),
    ev({ id: "ref-2", title: "低GI 宣称文献集（3 篇）", kind: "literature", confidence: "unknown", source: "PubMed", excerpt: "两项 RCT 与一项队列研究在终点指标上不可比。" }),
    ev({ id: "ref-4", title: "G2 评审包导出回执", kind: "runtime", verified: true, confidence: "high", source: "本机 Runtime · Atlas" }),
    ev({ id: "ref-5", title: "标签宣称合规预检结论", verified: true, confidence: "medium", source: "GB 7718 / GB 28050 比对" }),
    ev({ id: "ref-3", title: "渠道容量数据缺口说明", confidence: "unknown", source: "内部研究记录" }),
  ],
};
