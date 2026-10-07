import type { DesktopAction } from "../desktop-runtime/contracts";

/**
 * 受保护动作清单（Human Gate Catalog）—— 唯一事实源。
 *
 * 为什么有这个文件：同一份「什么必须先问人」的清单此前散落在
 * `supervisor/plan.ts`、`assistant-runtime/goal-plan.ts`（逐字复制）、
 * `app/muse/mission-timeline.ts`（中文标签）、`assistant-runtime/persona.ts`
 * （自然语言）、`assistant-runtime/autonomy.ts`（布尔维度）和
 * `governance/capability-policy.ts`（能力名）六处，互相之间没有任何校验。
 * 改一处漏一处时，模型被告知的边界、UI 展示给用户的边界、执行层真正拦截的边界
 * 会悄悄分叉。
 *
 * 这里只做「可枚举」：列出 gate，并把 autonomy 维度、受保护能力、本机动作
 * 全部映射到 gate。「可测试」由 `tests/kern-protected-actions.test.ts` 负责：
 * 任何一处新增而未登记、或登记了却没有覆盖，测试都会失败。
 *
 * 纯数据 + 纯函数，不引入运行时依赖（客户端组件也会引用）。
 */

export type HumanGateKind = "ACTION" | "DECISION";

export interface HumanGateDefinition {
  id: string;
  /** 给用户看的短标签 */
  label: string;
  /** ACTION = 一个具体动作的副作用；DECISION = 需要人拍板的取舍，不对应单个动作 */
  kind: HumanGateKind;
  /** 这个 gate 覆盖什么（写给接手的人，不进 prompt） */
  scope: string;
  /**
   * CORE persona 硬约束第 3 条里对应的关键词。模型侧必须被告知这条边界。
   * null = 当前 persona 没有提到（必须登记在 PERSONA_COVERAGE_GAPS 里并写明原因）。
   */
  personaCue: string | null;
}

export const HUMAN_GATES = [
  {
    id: "PAYMENT_OR_FINANCIAL_COMMITMENT",
    label: "付款或资金承诺",
    kind: "ACTION",
    scope: "付款、下单、订阅、预算承诺等任何花钱或承诺花钱的动作。",
    personaCue: "支付",
  },
  {
    id: "EXTERNAL_PUBLISH_OR_SEND",
    label: "对外发布或发送",
    kind: "ACTION",
    scope:
      "内容、代码或产品离开组织内部可撤回范围：对外发消息/邮件、公开发布、正式上线、合入受保护分支、部署生产。",
    personaCue: "对外发送",
  },
  {
    id: "IRREVERSIBLE_DELETE_OR_OVERWRITE",
    label: "不可逆的删除或覆盖",
    kind: "ACTION",
    scope:
      "删除、覆盖已有内容、破坏性迁移，以及能力边界无法事先界定的任意执行（shell / 脚本 / 本机 Agent）。",
    personaCue: "不可逆覆盖",
  },
  {
    id: "SENSITIVE_PERMISSION_CHANGE",
    label: "敏感权限变更",
    kind: "ACTION",
    scope: "授予或放宽成员、Agent、集成的权限与访问范围。",
    personaCue: "敏感权限",
  },
  {
    id: "FORMAL_BUSINESS_GATE",
    label: "正式业务关口",
    kind: "ACTION",
    scope: "G1 / G2 / G3 等正式业务 Gate 的审批。",
    personaCue: "G1/G2/G3",
  },
  {
    id: "LEGAL_OR_CONTRACT_COMMITMENT",
    label: "法律或合同承诺",
    kind: "ACTION",
    scope: "签署、接受条款、对外做出有约束力的承诺。",
    personaCue: "承诺",
  },
  {
    id: "STRATEGIC_VALUE_TRADEOFF",
    label: "战略取舍",
    kind: "DECISION",
    scope: "方向、定位、价值排序等需要负责人判断的取舍；不对应单个工具动作。",
    personaCue: null,
  },
  {
    id: "CREDENTIAL_USE_OR_DISCLOSURE",
    label: "使用或披露凭证",
    kind: "ACTION",
    scope: "使用、导出、转交密钥 / 口令 / Token 等凭证。",
    personaCue: "凭证",
  },
  {
    id: "PERSONAL_DATA_OR_LIKENESS",
    label: "个人信息或肖像",
    kind: "ACTION",
    scope: "对外使用或生成真实个人的信息、肖像、声音。",
    personaCue: "肖像",
  },
] as const satisfies readonly HumanGateDefinition[];

export type HumanGateId = (typeof HUMAN_GATES)[number]["id"];

export const HUMAN_GATE_IDS: readonly HumanGateId[] = HUMAN_GATES.map((g) => g.id);

export const HUMAN_GATE_LABEL: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(HUMAN_GATES.map((g) => [g.id, g.label]))
);

export function isHumanGateId(value: string): value is HumanGateId {
  return (HUMAN_GATE_IDS as readonly string[]).includes(value);
}

/**
 * persona 目前没有覆盖的 gate —— 显式登记，不默认放过。
 * 改 persona 时同步删除对应条目；测试会校验本表与实际覆盖情况完全一致。
 */
export const PERSONA_COVERAGE_GAPS: Readonly<Partial<Record<HumanGateId, string>>> = {
  STRATEGIC_VALUE_TRADEOFF:
    "DECISION 类，不是动作；persona 第 7 条「只有真正影响结果的歧义才向用户提出」承担这层语义。",
};

// ---------------------------------------------------------------------------
// autonomy 维度 → gate
// ---------------------------------------------------------------------------

/** `assistant-runtime/autonomy.ts` 中每个会触发 ASK 的风险维度对应的 gate。 */
export const AUTONOMY_DIMENSION_GATES = {
  financialImpact: ["PAYMENT_OR_FINANCIAL_COMMITMENT"],
  externalSideEffect: ["EXTERNAL_PUBLISH_OR_SEND"],
  permissionSensitive: ["SENSITIVE_PERMISSION_CHANGE"],
  productionRelease: ["EXTERNAL_PUBLISH_OR_SEND"],
  formalBusinessGate: ["FORMAL_BUSINESS_GATE"],
  destructive: ["IRREVERSIBLE_DELETE_OR_OVERWRITE"],
  irreversible: ["IRREVERSIBLE_DELETE_OR_OVERWRITE"],
} as const satisfies Record<string, readonly HumanGateId[]>;

// ---------------------------------------------------------------------------
// 受保护能力（ToolBroker）→ gate
// ---------------------------------------------------------------------------

/**
 * `governance/capability-policy.ts` 的 PROTECTED_CAPABILITIES 每一项都必须在这里
 * 说明它为什么受保护。测试校验两边键集合完全一致。
 */
export const PROTECTED_CAPABILITY_GATES: Readonly<Record<string, readonly HumanGateId[]>> = {
  "external.send": ["EXTERNAL_PUBLISH_OR_SEND"],
  "git.merge": ["EXTERNAL_PUBLISH_OR_SEND"],
  "deploy.production": ["EXTERNAL_PUBLISH_OR_SEND"],
  "database.migrate": ["IRREVERSIBLE_DELETE_OR_OVERWRITE"],
  "artifact.delete": ["IRREVERSIBLE_DELETE_OR_OVERWRITE"],
  "secret.use": ["CREDENTIAL_USE_OR_DISCLOSURE"],
  "shell.exec": ["IRREVERSIBLE_DELETE_OR_OVERWRITE"],
};

// ---------------------------------------------------------------------------
// 本机动作（Desktop Runtime）风险分级
// ---------------------------------------------------------------------------

export type DesktopTool = DesktopAction["tool"];

export type DesktopEffect =
  /** 只读，不改变任何状态 */
  | "READ_ONLY"
  /** 改变本机状态，但可撤回或影响可忽略 */
  | "LOCAL_REVERSIBLE"
  /** 可能覆盖已有内容 */
  | "LOCAL_OVERWRITE"
  /** 能力边界无法事先界定（任意命令 / 脚本 / Agent） */
  | "UNBOUNDED";

export interface DesktopToolRisk {
  effect: DesktopEffect;
  /** 最坏情况下触及的 gate（按工具能力，不按某次具体参数） */
  gates: readonly HumanGateId[];
  /** 对应 ToolBroker 的受保护能力名（如有） */
  capability: string | null;
  /**
   * 谁在副作用发生前拦下这个 gate：
   * - SERVER：服务端入队前要求人确认（ToolBroker / ApprovalGrant）；
   * - EXECUTOR：执行端在真正改动之前停下，回 WAITING_HUMAN 由用户决定；
   * - NONE：没有拦截，只有 mitigation 里的缓解措施（已知缺口）。
   * 2026-09-27 实测：`enqueueDesktopTask` 对任何工具都直接入队，目前没有 SERVER 项。
   */
  enforcement: "SERVER" | "EXECUTOR" | "NONE";
  /** 拦截方式或现有缓解措施的说明；触及 gate 的工具必填 */
  mitigation: string | null;
}

/**
 * 按工具穷举。类型为 Record<DesktopTool, …>：新增一个 DesktopAction 而不在这里分级，
 * TypeScript 直接报错；运行时测试再兜一次（防止 `as` 绕过）。
 */
export const DESKTOP_TOOL_RISK: Readonly<Record<DesktopTool, DesktopToolRisk>> = {
  "fs.list": { effect: "READ_ONLY", gates: [], capability: null, enforcement: "NONE", mitigation: null },
  "fs.read_text": { effect: "READ_ONLY", gates: [], capability: null, enforcement: "NONE", mitigation: null },
  "git.status": { effect: "READ_ONLY", gates: [], capability: null, enforcement: "NONE", mitigation: null },
  "git.diff": { effect: "READ_ONLY", gates: [], capability: null, enforcement: "NONE", mitigation: null },
  "clipboard.read": { effect: "READ_ONLY", gates: [], capability: null, enforcement: "NONE", mitigation: null },
  "fs.mkdir": { effect: "LOCAL_REVERSIBLE", gates: [], capability: null, enforcement: "NONE", mitigation: null },
  "browser.open": { effect: "LOCAL_REVERSIBLE", gates: [], capability: null, enforcement: "NONE", mitigation: null },
  "app.open": { effect: "LOCAL_REVERSIBLE", gates: [], capability: null, enforcement: "NONE", mitigation: null },
  "clipboard.write": { effect: "LOCAL_REVERSIBLE", gates: [], capability: null, enforcement: "NONE", mitigation: null },
  "notification.send": { effect: "LOCAL_REVERSIBLE", gates: [], capability: null, enforcement: "NONE", mitigation: null },
  "fs.write_text": {
    effect: "LOCAL_OVERWRITE",
    gates: ["IRREVERSIBLE_DELETE_OR_OVERWRITE"],
    capability: null,
    enforcement: "EXECUTOR",
    mitigation:
      "执行端覆盖保护（desktop-runtime/local-fs.ts）：排他创建，目标已存在 → WAITING_HUMAN 且不改动原文件；" +
      "只有显式「覆盖写入」「追加到」才动已有内容。仅限 HERMES_DESKTOP_ALLOWED_ROOTS 内。",
  },
  "fs.move": {
    effect: "LOCAL_OVERWRITE",
    gates: ["IRREVERSIBLE_DELETE_OR_OVERWRITE"],
    capability: null,
    enforcement: "EXECUTOR",
    mitigation:
      "执行端覆盖保护（desktop-runtime/local-fs.ts）：目标已存在 → WAITING_HUMAN，两边都不动；" +
      "只有显式「覆盖移动」才覆盖。检查与 rename 之间有竞态窗口（防的是按指令误覆盖，不是并发写者）。",
  },
  "shell.run": {
    effect: "UNBOUNDED",
    gates: ["IRREVERSIBLE_DELETE_OR_OVERWRITE"],
    capability: "shell.exec",
    enforcement: "SERVER",
    mitigation:
      "KX-35 服务端分级（desktop-runtime/confirmation.ts）：只读单条命令自动执行；其余需用户在确认卡「允许一次」，" +
      "签发绑定 actionHash 的单次 ApprovalGrant，claim 时核验并消耗；命中 isDangerousShellCommand 服务端直接拒绝。cwd 限 allowed roots。",
  },
  "mac.applescript": {
    effect: "UNBOUNDED",
    gates: ["IRREVERSIBLE_DELETE_OR_OVERWRITE", "EXTERNAL_PUBLISH_OR_SEND"],
    capability: null,
    enforcement: "NONE",
    mitigation: "执行端默认关闭，需 HERMES_DESKTOP_ALLOW_APPLESCRIPT=1 且授予辅助功能权限。",
  },
  "agent.delegate": {
    effect: "UNBOUNDED",
    gates: ["IRREVERSIBLE_DELETE_OR_OVERWRITE"],
    capability: null,
    enforcement: "SERVER",
    mitigation:
      "KX-35：每次交给本机 Agent 都需用户确认（单次 ApprovalGrant，claim 时核验并消耗）；" +
      "cwd 限 allowed roots；Codex CLI 以 --sandbox workspace-write 运行。",
  },
};

/** 某次具体动作触及的 gate（考虑参数：追加写入不算覆盖）。 */
export function desktopActionGates(action: DesktopAction): readonly HumanGateId[] {
  if (action.tool === "fs.write_text" && action.append) return [];
  return DESKTOP_TOOL_RISK[action.tool]?.gates ?? ["IRREVERSIBLE_DELETE_OR_OVERWRITE"];
}
