export const KERN_CAPABILITY_CATALOG = [
  {
    key: "workspace",
    label: "工作状态",
    description: "查看产品、项目、待办和需要你决定的事项。",
    intents: ["WORKSPACE_STATUS", "PENDING_DECISIONS", "PRODUCT_STATUS"],
  },
  {
    key: "knowledge",
    label: "知识库",
    description: "检索公司事实、知识文档和已有依据。",
    intents: ["KNOWLEDGE_SEARCH"],
  },
  {
    key: "product-write",
    label: "产品操作",
    description: "建立产品、修改方案字段、创建工作项。",
    intents: [
      "PENDING_PROPOSALS",
      "PROPOSE_FIELD_CHANGE",
      "PROPOSE_CREATE_WORK_ITEM",
      "NEW_PRODUCT_INTAKE",
    ],
  },
  {
    key: "product-rnd",
    label: "产品研发",
    description: "启动、跟踪并读取完整 Product R&D。",
    intents: ["START_PRODUCT_RND", "PRODUCT_RND_STATUS", "PRODUCT_RND_REPORT"],
  },
  {
    key: "challenge",
    label: "挑战判断",
    description: "证伪、红队和关键假设压力测试。",
    intents: ["CHALLENGE_THESIS"],
  },
  {
    key: "desktop",
    label: "本机执行",
    description: "通过 Desktop Runtime 使用文件、终端、Git、浏览器等本机能力。",
    intents: ["DESKTOP_EXECUTION"],
  },
  {
    key: "visualize",
    label: "可视化",
    description: "生成 KernGraph / Archify 风格的结构、依赖和顾问图。",
    intents: [],
  },
] as const;

export type KernCapabilityKey =
  (typeof KERN_CAPABILITY_CATALOG)[number]["key"];

export function capabilityKeyForIntent(intent: string): KernCapabilityKey | null {
  const item = KERN_CAPABILITY_CATALOG.find((candidate) =>
    (candidate.intents as readonly string[]).includes(intent)
  );
  return item?.key ?? null;
}
