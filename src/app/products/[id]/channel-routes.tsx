"use client";

import React from "react";
import { Badge, Empty, Thinking } from "@/components/ui";

type Rule = {
  id: string;
  channelKey: string;
  label: string;
  version: string;
  status: "ASSUMED" | "CONFIRMED";
  sourceRefs: unknown;
  minRetailPrice: string | number | null;
  maxRetailPrice: string | number | null;
  minBundleQuantity: number | null;
  maxBundleQuantity: number | null;
  allowedUnitLabels: unknown;
  commissionRate: string | number;
  platformFeeRate: string | number;
  marketingRate: string | number;
  managementFeeRate: string | number;
  returnRate: string | number;
  returnHandlingFeeRate: string | number;
  targetContributionMarginRate: string | number;
  constraints: unknown;
};

type Evaluation = {
  feasible?: boolean;
  blockers?: string[];
  warnings?: string[];
  channelTakeRate?: number;
  expectedChannelCost?: number;
  landedProductCost?: number;
  contribution?: number;
  contributionMarginRate?: number;
  requiredMaxProductCostPerUnit?: number | null;
};

type Route = {
  id: string;
  routeKey: string;
  revision: number;
  name: string;
  status: string;
  retailPrice: string | number;
  bundleQuantity: number;
  unitLabel: string;
  packageSpec: string | null;
  productCostPerUnit: string | number;
  packagingCostPerOrder: string | number;
  freightCostPerOrder: string | number;
  currency: string;
  ruleStatusSnapshot: string;
  ruleVersionSnapshot: string;
  evaluationSnapshot: Evaluation;
  feasible: boolean;
  blockerCount: number;
  contributionMarginRate: string | number;
  requiredMaxProductCostPerUnit: string | number | null;
  ruleCurrentlyEffective: boolean;
  needsReevaluation: boolean;
  channelRuleProfile: {
    channelKey: string;
    label: string;
    version: string;
    status: string;
    effectiveFrom: string | null;
    effectiveUntil: string | null;
  };
};

type Assessment = {
  id: string;
  channelRouteId: string | null;
  ruleVersion: string;
  verdict: string;
  diagnosticIndex: string | number | null;
  coverageRatio: string | number;
  verifiedCoverageRatio: string | number;
  confidenceBand: string;
  marketValidationVerified: boolean;
  reasons: unknown;
  blockers: unknown;
  unknownGates: unknown;
  createdAt: string;
  channelRoute: {
    id: string;
    name: string;
    routeKey: string;
    revision: number;
    status: string;
  } | null;
};

type Workspace = {
  product: { id: string; name: string };
  currentVersion: {
    id: string;
    versionTag: string;
    targetCost: string | number | null;
    currency: string;
    isConfirmed: boolean;
  };
  rules: Rule[];
  routes: Route[];
  assessments: Assessment[];
  verifiedEvidence: Array<{
    id: string;
    hash: string;
    source: string;
    channel: string | null;
    contentOrUri: string;
    validationStatus: string;
    obtainedAt: string;
  }>;
  canManageRules: boolean;
  canEditRoutes: boolean;
};

const DIMENSIONS = [
  ["DEMAND", "需求强度"],
  ["CHANNEL_FIT", "渠道适配"],
  ["UNIT_ECONOMICS", "单位经济性"],
  ["DIFFERENTIATION", "差异化"],
  ["REPEAT_PURCHASE", "复购逻辑"],
  ["DELIVERY_FEASIBILITY", "交付可行性"],
  ["COMPANY_FIT", "公司资源适配"],
] as const;

const ROUTE_STATUS_LABEL: Record<string, string> = {
  DRAFT: "规则待确认 / 待生效",
  BLOCKED: "硬阻断",
  VALIDATION_READY: "可进入验证",
  VALIDATING: "验证中",
  CONFIRMED: "路线已确认",
  REJECTED: "已否决",
  SUPERSEDED: "已被替代",
};

const VERDICT_LABEL: Record<string, string> = {
  BLOCKED: "硬阻断",
  NEEDS_EVIDENCE: "继续补证",
  DEPRIORITIZE: "降低优先级",
  VALIDATE: "进入低成本验证",
  PRIORITIZE_FOR_VALIDATION: "提高验证优先级",
};

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function num(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: string | number | null | undefined, currency = "CNY") {
  const parsed = num(value);
  return parsed == null ? "未知" : `${parsed.toFixed(2)} ${currency}`;
}

function pct(value: string | number | null | undefined) {
  const parsed = num(value);
  return parsed == null ? "未知" : `${parsed.toFixed(1)}%`;
}

async function postAction(productId: string, payload: Record<string, unknown>) {
  const response = await fetch(`/api/products/${productId}/channel-routes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error || body?.message || "操作失败");
  }
  return body;
}

function routeTone(status: string): "ok" | "warn" | "danger" | "neutral" {
  if (status === "VALIDATION_READY" || status === "CONFIRMED") return "ok";
  if (status === "BLOCKED" || status === "REJECTED") return "danger";
  if (status === "DRAFT" || status === "VALIDATING") return "warn";
  return "neutral";
}

export default function ChannelRoutesPanel({ productId }: { productId: string }) {
  const [workspace, setWorkspace] = React.useState<Workspace | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [ruleForm, setRuleForm] = React.useState({
    channelKey: "",
    label: "",
    version: "v1",
    status: "ASSUMED",
    sourceRefs: "",
    minRetailPrice: "",
    maxRetailPrice: "",
    minBundleQuantity: "",
    maxBundleQuantity: "",
    allowedUnitLabels: "",
    commissionRate: "",
    platformFeeRate: "",
    marketingRate: "",
    managementFeeRate: "",
    returnRate: "",
    returnHandlingFeeRate: "",
    targetContributionMarginRate: "",
    effectiveFrom: "",
    effectiveUntil: "",
    constraints: "",
  });

  const [routeForm, setRouteForm] = React.useState({
    channelRuleProfileId: "",
    routeKey: "",
    name: "",
    retailPrice: "",
    bundleQuantity: "",
    unitLabel: "盒",
    packageSpec: "",
    productCostPerUnit: "",
    packagingCostPerOrder: "",
    freightCostPerOrder: "",
  });

  const [assessmentRouteId, setAssessmentRouteId] = React.useState("");
  const [routeReasons, setRouteReasons] = React.useState<Record<string, string>>({});
  const [dimensions, setDimensions] = React.useState(
    DIMENSIONS.map(([key]) => ({
      key,
      score: "",
      evidenceState: "UNKNOWN",
      rationale: "",
      sourceRefs: "",
    }))
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/products/${productId}/channel-routes`);
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error || body?.message || "渠道路线读取失败");
      }
      const next = body as Workspace;
      setWorkspace(next);
      setRouteForm((current) => ({
        ...current,
        channelRuleProfileId:
          current.channelRuleProfileId || next.rules[0]?.id || "",
      }));
      setAssessmentRouteId((current) => current || next.routes[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "渠道路线读取失败");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function run(
    payload: Record<string, unknown>,
    success: string,
    after?: () => void
  ) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await postAction(productId, payload);
      setMessage(success);
      after?.();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !workspace) {
    return (
      <Thinking
        label="正在读取渠道路线…"
        hint="读取规则、当前产品版本、已保存路线与潜力评估"
        steps={["读取组织级渠道规则", "读取当前产品版本", "读取路线与历史评估"]}
      />
    );
  }

  if (!workspace) {
    return <div className="hermes-banner is-danger">{error || "渠道路线不可用"}</div>;
  }

  const currency = workspace.currentVersion.currency || "CNY";
  const routeById = new Map(workspace.routes.map((route) => [route.id, route]));

  return (
    <div className="hermes-stack">
      <section className="hermes-theme-section">
        <div className="hermes-theme-head">
          <h2 className="hermes-theme-title">渠道规格路线</h2>
          <span className="hermes-inline">
            <Badge tone="neutral">{workspace.currentVersion.versionTag}</Badge>
            <Badge tone={workspace.currentVersion.isConfirmed ? "ok" : "warn"}>
              {workspace.currentVersion.isConfirmed ? "产品版本已确认" : "产品版本未确认"}
            </Badge>
          </span>
        </div>
        <p className="hermes-theme-conclusion">
          一个产品版本可以同时保留多套渠道规格。系统先检查价格带、组合数量、渠道费用与目标贡献毛利，再决定这条路线是否值得进入验证。
        </p>
        <p className="hermes-note">
          这里的“通过”只表示当前规则下经济性可行，不等于批准上市；ASSUMED 渠道规则也不能冒充已确认事实。同一渠道的市场验证只作用于该渠道路线，不跨渠道借用。
        </p>
      </section>

      {message ? <div className="hermes-banner is-ok">{message}</div> : null}
      {error ? <div className="hermes-banner is-danger">{error}</div> : null}

      <section className="hermes-theme-section">
        <div className="hermes-theme-head">
          <h2 className="hermes-theme-title">当前路线</h2>
          <Badge tone={workspace.routes.length > 0 ? "info" : "neutral"}>
            {workspace.routes.length} 条
          </Badge>
        </div>

        {workspace.routes.length === 0 ? (
          <Empty>
            还没有渠道路线。先录入真实或假设渠道规则，再保存第一套规格候选。
          </Empty>
        ) : (
          <div className="hermes-list">
            {workspace.routes.map((route) => {
              const evaluation = route.evaluationSnapshot || {};
              const blockers = Array.isArray(evaluation.blockers)
                ? evaluation.blockers
                : [];
              const warnings = Array.isArray(evaluation.warnings)
                ? evaluation.warnings
                : [];
              return (
                <div className="hermes-row" key={route.id}>
                  <div className="hermes-row-head">
                    <strong className="hermes-row-title">
                      {route.name} · r{route.revision}
                    </strong>
                    <span className="hermes-inline">
                      <Badge tone={routeTone(route.status)}>
                        {ROUTE_STATUS_LABEL[route.status] || route.status}
                      </Badge>
                      <Badge tone={route.ruleStatusSnapshot === "CONFIRMED" ? "ok" : "warn"}>
                        {route.channelRuleProfile.label} / {route.ruleVersionSnapshot}
                        {route.ruleStatusSnapshot === "ASSUMED" ? " · 假设" : " · 已确认"}
                      </Badge>
                      {route.needsReevaluation ? (
                        <Badge tone="danger">
                          {route.channelRuleProfile.status === "SUPERSEDED"
                            ? "当前规则已更新 · 需重评"
                            : "规则未生效或已过期 · 需重评"}
                        </Badge>
                      ) : null}
                    </span>
                  </div>
                  <div className="hermes-row-meta">
                    <span>
                      {money(route.retailPrice, currency)} / {route.bundleQuantity}
                      {route.unitLabel}
                    </span>
                    <span>单元成本 {money(route.productCostPerUnit, currency)}</span>
                    <span>
                      渠道综合费率 {pct(evaluation.channelTakeRate)}
                    </span>
                    <span>
                      贡献毛利率 {pct(route.contributionMarginRate)}
                    </span>
                  </div>
                  <div className="hermes-dim-body" style={{ marginTop: 8 }}>
                    <div>
                      <span className="hermes-section-label">订单贡献</span>
                      <p>{money(evaluation.contribution, currency)}</p>
                    </div>
                    <div>
                      <span className="hermes-section-label">可承受最高单元成本</span>
                      <p>{money(route.requiredMaxProductCostPerUnit, currency)}</p>
                    </div>
                    <div>
                      <span className="hermes-section-label">产品+履约成本</span>
                      <p>{money(evaluation.landedProductCost, currency)}</p>
                    </div>
                    <div>
                      <span className="hermes-section-label">渠道费用预期</span>
                      <p>{money(evaluation.expectedChannelCost, currency)}</p>
                    </div>
                  </div>
                  {blockers.length > 0 ? (
                    <div className="hermes-banner is-danger" style={{ marginTop: 10 }}>
                      <strong>硬阻断：</strong>
                      {blockers.join("；")}
                    </div>
                  ) : null}
                  {warnings.length > 0 ? (
                    <div className="hermes-banner is-warn" style={{ marginTop: 10 }}>
                      {warnings.join("；")}
                    </div>
                  ) : null}
                  {workspace.canEditRoutes &&
                  (route.status === "VALIDATION_READY" || route.status === "VALIDATING") ? (
                    <div className="hermes-row" style={{ marginTop: 10 }}>
                      <div className="hermes-row-head">
                        <strong className="hermes-row-title">路线验证状态</strong>
                        <span className="hermes-note">
                          只有同渠道真实 Evidence 被负责人确认后，路线才允许变成“已确认”。
                        </span>
                      </div>
                      <label className="hermes-label">
                        <span>否决原因（仅点“否决路线”时必填）</span>
                        <input
                          className="hermes-input"
                          value={routeReasons[route.id] || ""}
                          onChange={(event) =>
                            setRouteReasons({
                              ...routeReasons,
                              [route.id]: event.target.value,
                            })
                          }
                          placeholder="例如：达人机制变化、退货率超预期、规格体验差"
                        />
                      </label>
                      <div className="hermes-inline-end" style={{ marginTop: 8 }}>
                        {route.status === "VALIDATION_READY" ? (
                          <button
                            type="button"
                            className="hermes-primary-btn hermes-btn-sm"
                            disabled={busy}
                            onClick={() =>
                              run(
                                {
                                  action: "TRANSITION_ROUTE",
                                  routeId: route.id,
                                  targetStatus: "VALIDATING",
                                },
                                "路线已进入真实市场验证"
                              )
                            }
                          >
                            开始验证
                          </button>
                        ) : null}
                        {route.status === "VALIDATING" ? (
                          <button
                            type="button"
                            className="hermes-primary-btn hermes-btn-sm"
                            disabled={busy}
                            onClick={() =>
                              run(
                                {
                                  action: "TRANSITION_ROUTE",
                                  routeId: route.id,
                                  targetStatus: "CONFIRMED",
                                },
                                "路线已由真实同渠道验证确认"
                              )
                            }
                          >
                            确认路线
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="hermes-outline-btn hermes-btn-sm"
                          disabled={busy || !(routeReasons[route.id] || "").trim()}
                          onClick={() =>
                            run(
                              {
                                action: "TRANSITION_ROUTE",
                                routeId: route.id,
                                targetStatus: "REJECTED",
                                reason: routeReasons[route.id],
                              },
                              "路线已否决并保留历史记录"
                            )
                          }
                        >
                          否决路线
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {workspace.canEditRoutes ? (
        <details className="hermes-details" open={workspace.routes.length === 0}>
          <summary style={{ fontWeight: 600, padding: "4px 0" }}>
            新建 / 重算一条渠道路线
          </summary>
          <div className="hermes-row" style={{ marginTop: 12 }}>
            {workspace.rules.length === 0 ? (
              <div className="hermes-banner is-warn">
                目前没有可用渠道规则。组织管理员需要先在下方录入规则；系统不会内置虚构佣金率。
              </div>
            ) : (
              <>
                <div className="hermes-form-grid">
                  <label className="hermes-label">
                    <span>渠道规则</span>
                    <select
                      className="hermes-select"
                      value={routeForm.channelRuleProfileId}
                      onChange={(event) =>
                        setRouteForm({
                          ...routeForm,
                          channelRuleProfileId: event.target.value,
                        })
                      }
                    >
                      {workspace.rules.map((rule) => (
                        <option key={rule.id} value={rule.id}>
                          {rule.label} · {rule.version} · {rule.status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="hermes-label">
                    <span>路线 Key</span>
                    <input
                      className="hermes-input"
                      placeholder="kuaishou-299-12box"
                      value={routeForm.routeKey}
                      onChange={(event) =>
                        setRouteForm({ ...routeForm, routeKey: event.target.value })
                      }
                    />
                  </label>
                  <label className="hermes-label">
                    <span>路线名称</span>
                    <input
                      className="hermes-input"
                      placeholder="快手 299 / 12盒"
                      value={routeForm.name}
                      onChange={(event) =>
                        setRouteForm({ ...routeForm, name: event.target.value })
                      }
                    />
                  </label>
                  <label className="hermes-label">
                    <span>零售价（{currency}）</span>
                    <input
                      className="hermes-input"
                      inputMode="decimal"
                      value={routeForm.retailPrice}
                      onChange={(event) =>
                        setRouteForm({ ...routeForm, retailPrice: event.target.value })
                      }
                    />
                  </label>
                  <label className="hermes-label">
                    <span>组合数量</span>
                    <input
                      className="hermes-input"
                      inputMode="numeric"
                      value={routeForm.bundleQuantity}
                      onChange={(event) =>
                        setRouteForm({ ...routeForm, bundleQuantity: event.target.value })
                      }
                    />
                  </label>
                  <label className="hermes-label">
                    <span>售卖单位</span>
                    <input
                      className="hermes-input"
                      value={routeForm.unitLabel}
                      onChange={(event) =>
                        setRouteForm({ ...routeForm, unitLabel: event.target.value })
                      }
                    />
                  </label>
                  <label className="hermes-label">
                    <span>单元产品成本（{currency}）</span>
                    <input
                      className="hermes-input"
                      inputMode="decimal"
                      value={routeForm.productCostPerUnit}
                      onChange={(event) =>
                        setRouteForm({
                          ...routeForm,
                          productCostPerUnit: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="hermes-label">
                    <span>订单包装成本</span>
                    <input
                      className="hermes-input"
                      inputMode="decimal"
                      value={routeForm.packagingCostPerOrder}
                      onChange={(event) =>
                        setRouteForm({
                          ...routeForm,
                          packagingCostPerOrder: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="hermes-label">
                    <span>订单运费</span>
                    <input
                      className="hermes-input"
                      inputMode="decimal"
                      value={routeForm.freightCostPerOrder}
                      onChange={(event) =>
                        setRouteForm({
                          ...routeForm,
                          freightCostPerOrder: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="hermes-label">
                    <span>包装 / 规格说明（选填）</span>
                    <input
                      className="hermes-input"
                      value={routeForm.packageSpec}
                      onChange={(event) =>
                        setRouteForm({ ...routeForm, packageSpec: event.target.value })
                      }
                    />
                  </label>
                </div>
                <div className="hermes-inline-end" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="hermes-primary-btn hermes-btn-sm"
                    disabled={busy || !routeForm.channelRuleProfileId}
                    onClick={() =>
                      run(
                        {
                          action: "EVALUATE_ROUTE",
                          productVersionId: workspace.currentVersion.id,
                          ...routeForm,
                        },
                        "渠道路线已按确定性规则计算并保存"
                      )
                    }
                  >
                    {busy ? "计算中…" : "计算并保存路线"}
                  </button>
                </div>
              </>
            )}
          </div>
        </details>
      ) : (
        <div className="hermes-note">
          你可以查看渠道路线；修改产品路线需要该产品的 OWNER / DECISION_MAKER 权限。
        </div>
      )}

      {workspace.canManageRules ? (
        <details className="hermes-details">
          <summary style={{ fontWeight: 600, padding: "4px 0" }}>
            组织管理员：维护渠道规则
          </summary>
          <div className="hermes-row" style={{ marginTop: 12 }}>
            <div className="hermes-banner is-warn" style={{ marginBottom: 10 }}>
              ASSUMED 可用于推演；CONFIRMED 必须填写真实来源引用。新的 ASSUMED 草案只替代旧草案，不会提前作废当前 CONFIRMED 规则；新 CONFIRMED 版本发布后才替代旧确认规则。
            </div>
            <div className="hermes-form-grid">
              {[
                ["channelKey", "渠道 Key", "kuaishou"],
                ["label", "渠道名称", "快手直播"],
                ["version", "规则版本", "2026-q3"],
                ["minRetailPrice", "最低零售价", ""],
                ["maxRetailPrice", "最高零售价", ""],
                ["minBundleQuantity", "最小组合数", ""],
                ["maxBundleQuantity", "最大组合数", ""],
                ["allowedUnitLabels", "允许单位（逗号）", "盒,瓶"],
                ["commissionRate", "佣金率 %", ""],
                ["platformFeeRate", "平台费率 %", ""],
                ["marketingRate", "推广费率 %", ""],
                ["managementFeeRate", "管理费率 %", ""],
                ["returnRate", "退货率 %", ""],
                ["returnHandlingFeeRate", "退货处理费率 %", ""],
                ["targetContributionMarginRate", "目标贡献毛利率 %", ""],
                ["effectiveFrom", "生效起始时间（选填）", "2026-09-01"],
                ["effectiveUntil", "生效截止时间（选填）", "2026-12-31"],
                ["sourceRefs", "来源引用（逗号）", "合同/政策/确认记录"],
                ["constraints", "其他约束（逗号）", "多盒机制,包邮"],
              ].map(([key, label, placeholder]) => (
                <label className="hermes-label" key={key}>
                  <span>{label}</span>
                  <input
                    className="hermes-input"
                    placeholder={placeholder}
                    value={ruleForm[key as keyof typeof ruleForm]}
                    onChange={(event) =>
                      setRuleForm({ ...ruleForm, [key]: event.target.value })
                    }
                  />
                </label>
              ))}
              <label className="hermes-label">
                <span>可信状态</span>
                <select
                  className="hermes-select"
                  value={ruleForm.status}
                  onChange={(event) =>
                    setRuleForm({ ...ruleForm, status: event.target.value })
                  }
                >
                  <option value="ASSUMED">ASSUMED · 假设</option>
                  <option value="CONFIRMED">CONFIRMED · 已确认</option>
                </select>
              </label>
            </div>
            <div className="hermes-inline-end" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="hermes-outline-btn hermes-btn-sm"
                disabled={busy}
                onClick={() =>
                  run(
                    {
                      action: "CREATE_RULE",
                      ...ruleForm,
                      sourceRefs: ruleForm.sourceRefs
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                      allowedUnitLabels: ruleForm.allowedUnitLabels
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                      constraints: ruleForm.constraints
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    },
                    "渠道规则版本已保存"
                  )
                }
              >
                保存渠道规则
              </button>
            </div>
          </div>
        </details>
      ) : null}

      {workspace.canEditRoutes ? (
        <details className="hermes-details">
          <summary style={{ fontWeight: 600, padding: "4px 0" }}>
            产品潜力评估（路线级）
          </summary>
          <div className="hermes-row" style={{ marginTop: 12 }}>
            <div className="hermes-banner is-warn" style={{ marginBottom: 10 }}>
              这里的分数是“当前证据下的诊断指数”，不是成功概率。路线经济性失败会直接形成 Hard Gate，不能被其它高分平均掉；真实市场验证状态由 Evidence 自动推导。
            </div>
            <div className="hermes-note" style={{ marginBottom: 10 }}>
              当前产品已有 {workspace.verifiedEvidence.length} 条 REAL + VERIFIED Evidence 可直接引用。维度选择 VERIFIED 时，必须至少引用其中一条，不能手工把假设升级成已验证事实。
            </div>
            <label className="hermes-label">
              <span>评估路线</span>
              <select
                className="hermes-select"
                value={assessmentRouteId}
                onChange={(event) => setAssessmentRouteId(event.target.value)}
              >
                <option value="">不绑定渠道路线（仅产品总体）</option>
                {workspace.routes.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.name} · r{route.revision}
                  </option>
                ))}
              </select>
            </label>

            <div className="hermes-list" style={{ marginTop: 12 }}>
              {dimensions.map((dimension, index) => {
                const label =
                  DIMENSIONS.find(([key]) => key === dimension.key)?.[1] ||
                  dimension.key;
                return (
                  <div className="hermes-row" key={dimension.key}>
                    <div className="hermes-row-head">
                      <strong className="hermes-row-title">{label}</strong>
                      <span className="hermes-chip">{dimension.key}</span>
                    </div>
                    <div className="hermes-form-grid">
                      <label className="hermes-label">
                        <span>诊断分 0-100；未知留空</span>
                        <input
                          className="hermes-input"
                          inputMode="decimal"
                          value={dimension.score}
                          onChange={(event) => {
                            const next = [...dimensions];
                            next[index] = { ...dimension, score: event.target.value };
                            setDimensions(next);
                          }}
                        />
                      </label>
                      <label className="hermes-label">
                        <span>证据状态</span>
                        <select
                          className="hermes-select"
                          value={dimension.evidenceState}
                          onChange={(event) => {
                            const next = [...dimensions];
                            const evidenceState = event.target.value;
                            next[index] = {
                              ...dimension,
                              evidenceState,
                              score:
                                evidenceState === "UNKNOWN" ? "" : dimension.score,
                            };
                            setDimensions(next);
                          }}
                        >
                          <option value="UNKNOWN">UNKNOWN</option>
                          <option value="ASSUMED">ASSUMED</option>
                          <option value="SUPPORTED">SUPPORTED</option>
                          <option value="VERIFIED">VERIFIED</option>
                        </select>
                      </label>
                      <label className="hermes-label">
                        <span>判断理由</span>
                        <input
                          className="hermes-input"
                          value={dimension.rationale}
                          onChange={(event) => {
                            const next = [...dimensions];
                            next[index] = {
                              ...dimension,
                              rationale: event.target.value,
                            };
                            setDimensions(next);
                          }}
                        />
                      </label>
                      <label className="hermes-label">
                        <span>来源引用（逗号）</span>
                        <input
                          className="hermes-input"
                          value={dimension.sourceRefs}
                          onChange={(event) => {
                            const next = [...dimensions];
                            next[index] = {
                              ...dimension,
                              sourceRefs: event.target.value,
                            };
                            setDimensions(next);
                          }}
                        />
                        <select
                          className="hermes-select"
                          value=""
                          disabled={workspace.verifiedEvidence.length === 0}
                          onChange={(event) => {
                            const ref = event.target.value;
                            if (!ref) return;
                            const existing = dimension.sourceRefs
                              .split(",")
                              .map((item) => item.trim())
                              .filter(Boolean);
                            const next = [...dimensions];
                            next[index] = {
                              ...dimension,
                              sourceRefs: [...new Set([...existing, ref])].join(", "),
                            };
                            setDimensions(next);
                          }}
                          style={{ marginTop: 6 }}
                        >
                          <option value="">
                            {workspace.verifiedEvidence.length > 0
                              ? "添加已核实 Evidence…"
                              : "暂无已核实 Evidence"}
                          </option>
                          {workspace.verifiedEvidence.map((evidence) => (
                            <option key={evidence.id} value={evidence.id}>
                              {(evidence.channel || "未标渠道") + " · " + evidence.source + " · " + evidence.id.slice(0, 8)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="hermes-inline-end" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="hermes-primary-btn hermes-btn-sm"
                disabled={busy}
                onClick={() =>
                  run(
                    {
                      action: "ASSESS_POTENTIAL",
                      productVersionId: workspace.currentVersion.id,
                      channelRouteId: assessmentRouteId || null,
                      dimensions: dimensions.map((dimension) => ({
                        key: dimension.key,
                        score: dimension.score === "" ? null : Number(dimension.score),
                        evidenceState: dimension.evidenceState,
                        rationale: dimension.rationale,
                        sourceRefs: dimension.sourceRefs
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      })),
                      gates: [],
                    },
                    "潜力评估已形成新的不可覆盖快照"
                  )
                }
              >
                保存潜力评估快照
              </button>
            </div>
          </div>
        </details>
      ) : null}

      <section className="hermes-theme-section">
        <div className="hermes-theme-head">
          <h2 className="hermes-theme-title">潜力评估历史</h2>
          <Badge tone={workspace.assessments.length > 0 ? "info" : "neutral"}>
            {workspace.assessments.length} 条
          </Badge>
        </div>
        {workspace.assessments.length === 0 ? (
          <Empty>
            尚未保存 Product Potential V2 快照。路线经济性可以先独立评估，不必为了“有个总分”强行补未知数据。
          </Empty>
        ) : (
          <div className="hermes-list">
            {workspace.assessments.map((assessment) => {
              const route =
                assessment.channelRoute ||
                (assessment.channelRouteId
                  ? routeById.get(assessment.channelRouteId) || null
                  : null);
              return (
                <div className="hermes-row" key={assessment.id}>
                  <div className="hermes-row-head">
                    <strong className="hermes-row-title">
                      {VERDICT_LABEL[assessment.verdict] || assessment.verdict}
                    </strong>
                    <span className="hermes-inline">
                      <Badge
                        tone={
                          assessment.verdict === "BLOCKED"
                            ? "danger"
                            : assessment.verdict === "NEEDS_EVIDENCE"
                              ? "warn"
                              : "info"
                        }
                      >
                        {assessment.confidenceBand}
                      </Badge>
                      {assessment.marketValidationVerified ? (
                        <Badge tone="ok">已有负责人确认的真实市场验证</Badge>
                      ) : (
                        <Badge tone="neutral">尚无已确认市场验证</Badge>
                      )}
                    </span>
                  </div>
                  <div className="hermes-row-meta">
                    <span>
                      路线 {route ? `${route.name} · r${route.revision}` : "产品总体"}
                    </span>
                    <span>
                      诊断指数{" "}
                      {assessment.diagnosticIndex == null
                        ? "未知"
                        : Number(assessment.diagnosticIndex).toFixed(1)}
                    </span>
                    <span>
                      覆盖率 {(Number(assessment.coverageRatio) * 100).toFixed(0)}%
                    </span>
                    <span>
                      已验证覆盖{" "}
                      {(Number(assessment.verifiedCoverageRatio) * 100).toFixed(0)}%
                    </span>
                  </div>
                  {list(assessment.reasons).length > 0 ? (
                    <div className="hermes-row-body">
                      {list(assessment.reasons).join("；")}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
