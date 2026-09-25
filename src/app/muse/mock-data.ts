/**
 * Minimal conversation-first fixture for isolated UI work.
 * Production pages use src/modules/muse/read-model.ts.
 */
import type {
  Decision,
  Employee,
  EvidenceRef,
  Message,
  StudioModel,
} from "./types";

const ev = (
  o: Partial<EvidenceRef> & { id: string; title: string }
): EvidenceRef => ({
  kind: "internal",
  source: "Kern 内部记录",
  confidence: "medium",
  verified: false,
  capturedAt: "今天 09:12",
  ...o,
});

const employees: Employee[] = [
  {
    id: "e-hermes",
    name: "Kern",
    role: "Agent Assistant",
    mark: "K",
    state: "idle",
    currentFocus: null,
    load: 0,
    skills: ["理解", "规划", "路由", "执行", "汇报"],
  },
];

const decisions: Decision[] = [
  {
    id: "d-release",
    title: "正式发布产品页",
    because: "这是对外发布动作，会产生外部影响。",
    ifIgnored: "草稿保持不变，不会自动上线。",
    tone: "warn",
    gate: "Production Release",
    conversationId: "c-1",
    dueLabel: "需要你确认",
    raisedBy: "Kern",
    options: [
      { id: "approve", label: "批准发布", kind: "approve" },
      { id: "reject", label: "不发布", kind: "reject" },
    ],
    evidence: [],
  },
];

const messages: Message[] = [
  {
    id: "msg-1",
    author: "user",
    at: "09:02",
    state: "success",
    blocks: [{ kind: "text", text: "把这个产品页整理好，能直接做的你都处理。" }],
  },
  {
    id: "msg-2",
    author: "kern",
    byEmployeeId: "e-hermes",
    at: "09:06",
    state: "success",
    blocks: [
      {
        kind: "text",
        text: "已完成内部可逆修改并通过检查。正式发布属于外部动作，需要你最后确认。",
      },
    ],
  },
];

export const studioModel: StudioModel = {
  activeConversationId: "c-1",
  managementHref: "/manage",
  newConversationProduct: null,
  initialDraft: "",
  user: { name: "你", role: "产品负责人", org: "Kern Workspace" },
  brief: {
    decisions,
    conversations: [
      {
        id: "c-1",
        title: "产品页整理",
        preview: "已完成内部修改，等待正式发布 Gate。",
        state: "needs-review",
        productId: "p-1",
        productName: "示例产品",
        startedAt: "今天 09:02",
      },
    ],
    suggestions: [
      {
        id: "s-1",
        title: "交代一项工作",
        why: "Kern 会自己规划和推进",
        prompt: "帮我处理这件事：",
      },
    ],
  },
  employees,
  messages,
  activity: [
    {
      id: "a-1",
      at: "09:05",
      state: "success",
      actorId: "e-hermes",
      text: "完成内部可逆修改",
      conversationId: "c-1",
    },
  ],
  runtime: {
    connected: true,
    host: "MacBook Pro",
    lastHeartbeat: "12 秒前",
    capabilities: [],
    activeAction: null,
  },
  evidence: [
    ev({
      id: "ref-1",
      title: "本机执行回执",
      kind: "runtime",
      verified: true,
      confidence: "high",
      source: "Desktop Runtime",
    }),
  ],
};
