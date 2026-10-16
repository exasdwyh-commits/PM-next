/**
 * 提议内容摘要（**零依赖**：服务端 read-model 与客户端组件共用同一份措辞）
 *
 * 为什么单独抽出来：
 * - 建品提议此前在界面上只能看到「新建产品并立项 · 当前工作」，看不到将要写入的五项内容，
 *   批准前无法核对，属于「看得见按钮、看不见内容」。
 * - 摘要逻辑此前分散在 proposal-card（客户端）与 read-model（服务端）两处，措辞会漂移；
 *   收口到这里，两边读同一份。
 *
 * 刻意不做：
 * - 不补内容：缺哪一项就写「未提供」，绝不替用户生成一个值。
 * - 不改权限、不改数据库结构、不参与能力评分。
 */

export interface ProposalSummaryLine {
  k: string;
  v: string;
}

const EMPTY = "未提供";

function text(v: unknown, max = 140): string {
  if (v === null || v === undefined || v === "") return EMPTY;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export const PROPOSAL_ACTION_LABEL: Record<string, string> = {
  CREATE_PRODUCT: "新建产品并立项",
  UPDATE_FIELD: "修改产品方案字段",
  CREATE_WORK_ITEM: "创建内部工作项",
  CREATE_REVISION: "创建产品新版本",
};

/** 建品五项（与 assistant-runtime/intent-grammar 的 INTAKE_FIELDS 对齐，键名不一致会让摘要变空） */
const INTAKE_LINES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "name", label: "名称" },
  { key: "coreIdea", label: "一句话想法" },
  { key: "targetAudience", label: "目标人群与场景" },
  { key: "coreSellingPoints", label: "核心卖点" },
  { key: "targetChannels", label: "预期渠道" },
];

export function summarizeProposal(
  actionType: string,
  payloadJson: unknown
): { label: string; lines: ProposalSummaryLine[] } {
  const p = (payloadJson && typeof payloadJson === "object" ? payloadJson : {}) as Record<string, any>;
  const label = PROPOSAL_ACTION_LABEL[actionType] ?? actionType;

  if (actionType === "CREATE_PRODUCT") {
    return { label, lines: INTAKE_LINES.map((f) => ({ k: f.label, v: text(p[f.key]) })) };
  }
  if (actionType === "UPDATE_FIELD") {
    return {
      label,
      lines: [
        { k: "字段", v: text(p.fieldLabel ?? p.field) },
        { k: "改为", v: text(p.value) },
        { k: "依据版本", v: text(p.baseVersionTag) },
      ],
    };
  }
  if (actionType === "CREATE_WORK_ITEM") {
    return {
      label,
      lines: [
        { k: "标题", v: text(p.title) },
        { k: "目标", v: text(p.target) },
        { k: "交付要求", v: text(p.deliverableReq) },
      ],
    };
  }
  return { label, lines: [{ k: "载荷", v: text(JSON.stringify(p), 240) }] };
}

/**
 * 空证据提示。此前所有决策共用一句「这件事目前没有可追溯的依据」——
 * 对建品提议不成立：它的依据就是用户在本会话里说的五项内容，只是没有外部来源可回溯。
 */
export function proposalEmptyEvidenceHint(actionType: string): string {
  if (actionType === "CREATE_PRODUCT") {
    return "依据是你在本会话里说的五项内容；没有附加外部来源。需要外部佐证时，先让 Kern 去补再确认。";
  }
  return "这件事目前没有可追溯的依据，确认前可以让 Kern 先去补。";
}

/** 提议类决策的 gate 中文名（此前界面直接渲染英文 `Proposal / Approval`） */
export const PROPOSAL_DECISION_GATE = "需你批准的业务写入";
