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
  /**
   * 模型经由哪条通道接入：
   * - `GATEWAY`：Model Gateway（当前事实源，profile + policy 在库里）
   * - `ADVISOR_LEGACY`：旧 ADVISOR_* 直连通道（兼容保留）
   * - `NONE`：没有任何模型端点
   */
  path: "GATEWAY" | "ADVISOR_LEGACY" | "NONE";
}

/**
 * 扫描已配置的 provider 运行时端点。
 *
 * 与 model-gateway/provider-runtime 的 `MODEL_PROVIDER_<TOKEN>_BASE_URL`
 * 约定逐字一致（同一份正则规则）。这里只做**环境事实**陈述：
 * 某个 provider 的端点环境变量存在，就报告它存在——不推断可达性，
 * 也不假装知道库里 profile 是否 enabled（那属于 Model Control 的职责）。
 */
function scanConfiguredProviderRuntimes(): string[] {
  const prefix = "MODEL_PROVIDER_";
  const suffix = "_BASE_URL";
  const found = new Set<string>();
  for (const [key, raw] of Object.entries(process.env)) {
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
    if (!raw?.trim()) continue;
    const token = key.slice(prefix.length, key.length - suffix.length);
    if (!/^[A-Z0-9_]+$/.test(token)) continue;
    found.add(token.toLowerCase());
  }
  return [...found].sort();
}

/**
 * 运行时状态。
 *
 * ⚠️ 2026-10-04 修正（诚实口径 bug）：此前只看 `ADVISOR_MODEL_PROVIDER` /
 * `ADVISOR_MODEL_ID` 这条**已废弃**的直连通道，于是即使 Model Gateway 里
 * profile 已启用、对话实际正在跑模型，界面仍显示「模型未配置 ·
 * 顾问对话未接入」——那是在对用户说假话。现在以 Gateway 为主通道判定，
 * 旧通道仅作为回退保留。
 */
export function getRuntimeStatus(): RuntimeStatus {
  const legacyProvider = process.env.ADVISOR_MODEL_PROVIDER?.trim() || null;
  const legacyModelId = process.env.ADVISOR_MODEL_ID?.trim() || null;
  const gatewayProviders = scanConfiguredProviderRuntimes();

  if (gatewayProviders.length > 0) {
    const shown = gatewayProviders.slice(0, 2).join(" / ");
    const more = gatewayProviders.length > 2 ? ` 等 ${gatewayProviders.length} 个` : "";
    return {
      tone: "neutral",
      label: "模型端点已配置",
      detail: `Model Gateway · ${shown}${more}（启用状态与连通性需分别确认）`,
      modelConfigured: true,
      provider: gatewayProviders[0] ?? null,
      modelId: null,
      path: "GATEWAY",
    };
  }

  if (legacyProvider && legacyModelId) {
    return {
      tone: "neutral",
      label: "模型已配置",
      detail: `${legacyProvider} · ${legacyModelId}（兼容配置，经统一网关调用）`,
      modelConfigured: true,
      provider: legacyProvider,
      modelId: legacyModelId,
      path: "ADVISOR_LEGACY",
    };
  }

  return {
    tone: "warn",
    label: "模型未配置",
    detail: "规则分析可用 · 顾问对话未接入",
    modelConfigured: false,
    provider: legacyProvider,
    modelId: legacyModelId,
    path: "NONE",
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
