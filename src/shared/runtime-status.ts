/**
 * 运行时状态（蓝图 §5.1 / §8）
 *
 * 侧栏底部与顾问页必须展示**真实**运行状态：
 * - 未配置模型端点时明确写「模型未配置」，绝不显示「AI 在线」；
 * - 费用未知即标未知，不编造额度。
 */

export interface RuntimeStatus {
  tone: "ok" | "warn" | "neutral";
  label: string;
  detail: string;
  /** 是否已接入可用模型端点（由配置决定，不代表已验证可达） */
  modelConfigured: boolean;
  provider: string | null;
  modelId: string | null;
}

export function getRuntimeStatus(): RuntimeStatus {
  const provider = process.env.ADVISOR_MODEL_PROVIDER?.trim() || null;
  const modelId = process.env.ADVISOR_MODEL_ID?.trim() || null;

  if (!provider || !modelId) {
    return {
      tone: "warn",
      label: "模型未配置",
      detail: "规则分析可用 · 顾问对话未接入",
      modelConfigured: false,
      provider,
      modelId,
    };
  }

  return {
    tone: "neutral",
    label: "模型已配置",
    detail: `${provider} · ${modelId}`,
    modelConfigured: true,
    provider,
    modelId,
  };
}

/**
 * 开发态免密身份是否可用。
 *
 * 用途：服务端把该布尔传给客户端，客户端**只在此为 true 时**才渲染「身份切换」下拉，
 * 并且才在请求里附带 `x-user-id` 头。
 *
 * 原因（实测踩坑）：生产环境下 `getServerSession` 一旦看到 `x-user-id` 就直接抛
 * `ForbiddenError: Dev mock auth headers are strictly forbidden in production`。
 * 也就是说带着 cookie 同时还发这个头，会让写操作全部 403 —— 这是开发态便利
 * 泄漏到正式路径的真实故障，必须由服务端开关收口，不能靠客户端自觉。
 */
export function isMockAuthEnabled(): boolean {
  return process.env.DEV_MOCK_AUTH === "true" && process.env.NODE_ENV !== "production";
}
