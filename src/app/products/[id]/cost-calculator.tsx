"use client";

import React from "react";
import { Badge, Empty, KV, cx } from "@/components/ui";
import Icon from "@/components/icons";
import { calcCost, applyDefaults } from "@/modules/cost-engine";
import {
  CHANNEL_PRESETS,
  EXPRESS_PRESETS,
  INVOICE_PRESETS,
} from "@/modules/cost-engine/presets";
import type { Channel, CostInput, CostResult, ExpressType, InvoiceType } from "@/modules/cost-engine/types";

/**
 * 成本与供应 · 经济性计算器（产品详情「成本与供应」页签）
 *
 * TASK-012 新增：支持版本级读取、保存基础/保守情景和对比；
 * 默认值显式标假设，未知不转零，非支持币种不只换货币符号。
 * 页面刷新后可恢复已保存输入。
 */

const CHANNEL_OPTIONS = Object.entries(CHANNEL_PRESETS).map(([key, p]) => ({
  value: key as Channel,
  label: p.label,
  hint: p.description,
}));

const INVOICE_OPTIONS = Object.entries(INVOICE_PRESETS).map(([key, p]) => ({
  value: key as InvoiceType,
  label: p.label,
  hint: p.description,
}));

const EXPRESS_OPTIONS = Object.entries(EXPRESS_PRESETS).map(([key, p]) => ({
  value: key as ExpressType,
  label: p.label,
  hint: p.description,
}));

const REQUIRED_FIELDS: { key: keyof CostInput; label: string; step: string; hint?: string }[] = [
  { key: "materialCost", label: "直接材料成本（元/件）", step: "0.01", hint: "配方原料采购价" },
  { key: "packagingCost", label: "外包装成本（元/件）", step: "0.01" },
  { key: "manufacturingCost", label: "制造成本（元/件）", step: "0.01", hint: "加工/灌装" },
  { key: "certificationCost", label: "认证成本（元/件）", step: "0.01", hint: "检测/备案均摊" },
  { key: "monthlyFixed", label: "月固定成本（元/月）", step: "1", hint: "仅用于盈亏平衡量，不计入单件成本" },
  { key: "retailPrice", label: "含税零售价（元/件）", step: "0.01", hint: "终端售价" },
];

/** 单件成本明细：仅 L1–L5（L6 月固定成本不计入单件成本，单独呈现） */
const LAYER_ROWS: { key: keyof CostResult; label: string }[] = [
  { key: "layer1Material", label: "L1 直接材料（含损耗）" },
  { key: "layer2Packaging", label: "L2 包装（外 + 内）" },
  { key: "layer3Manufacturing", label: "L3 制造与认证" },
  { key: "layer4Freight", label: "L4 物流仓储" },
  { key: "layer5Channel", label: "L5 渠道费用" },
];

const TAX_ROWS: { key: keyof CostResult; label: string }[] = [
  { key: "settlementSalesExclVat", label: "不含税销售额" },
  { key: "outputVat", label: "销项税额" },
  { key: "totalDeductibleInputVat", label: "可抵扣进项税" },
  { key: "payableVat", label: "应交增值税" },
  { key: "payableSurtax", label: "应交附加税" },
  { key: "payableIncomeTax", label: "企业所得税" },
  { key: "netProfit", label: "净利润" },
  { key: "totalTax", label: "总税费" },
];

const SUPPLY_ROWS: { key: keyof CostResult; label: string }[] = [
  { key: "supplyPriceFloor", label: "保底供货价（不亏本）" },
  { key: "supplyPriceSuggested", label: "建议供货价" },
  { key: "supplyPriceCeiling", label: "顶价（市场锚定）" },
  { key: "finalSupplyPrice", label: "最终报价" },
];

/** 已保存的成本情景记录（来自 API） */
interface SavedScenario {
  artifactId: string;
  scenarioName: string;
  engineVersion: string;
  sourceStatus: string;
  unit: string;
  currency: string;
  expenseBase: string;
  /** 保存时的原始输入。早期保存的情景可能没有，此时不能假装能载入。 */
  costInput?: Partial<CostInput> | null;
  result: number;
  netProfit: number;
  contentVersion: number;
  createdAt: string;
}

function money(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return `¥${Number(n).toFixed(2)}`;
}

function pct(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return `${Number(n).toFixed(2)}%`;
}

export default function CostCalculator({
  targetCost,
  currency,
  versionTag,
  workItemId,
  productId,
  savedScenarios,
  onSaveScenario,
}: {
  targetCost: number | null;
  currency: string | null;
  versionTag: string | null;
  workItemId?: string;
  productId?: string;
  savedScenarios?: SavedScenario[];
  onSaveScenario?: (scenario: {
    scenarioName: string;
    costInput: CostInput;
    sourceStatus: "DRAFT" | "ACTIVE" | "ARCHIVED";
    unit: string;
    currency: string;
    expenseBase: string;
  }) => Promise<void>;
}) {
  const [form, setForm] = React.useState<Record<string, string>>({
    materialCost: "",
    packagingCost: "",
    manufacturingCost: "",
    certificationCost: "",
    // 不预填月固定成本：它直接决定盈亏平衡量，凭空给一个数会被当成用户自己填的。
    monthlyFixed: "",
    retailPrice: "",
    channel: "XINXUAN",
    invoiceType: "达人开票",
    expressType: "STANDARD",
    commissionRate: String(CHANNEL_PRESETS.XINXUAN.commissionRate),
    platformFeeRate: String(CHANNEL_PRESETS.XINXUAN.platformFeeRate),
    marketingRate: String(CHANNEL_PRESETS.XINXUAN.marketingRate),
    marketReferencePrice: "",
    targetMarginRate: "",
  });
  const [result, setResult] = React.useState<CostResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // ── TASK-012: 情景保存状态 ──
  const [scenarioName, setScenarioName] = React.useState("");
  const [scenarioSourceStatus, setScenarioSourceStatus] = React.useState<"DRAFT" | "ACTIVE" | "ARCHIVED">("DRAFT");
  const [saving, setSaving] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState<string | null>(null);

  // ── TASK-012: 情景对比状态 ──
  const [compareMode, setCompareMode] = React.useState(false);
  const [selectedScenarios, setSelectedScenarios] = React.useState<string[]>([]);

  const setField = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setResult(null);
  };

  // 切换渠道时按预设回填渠道费率（用户随后可手动覆盖）
  const onChannelChange = (value: string) => {
    const preset = CHANNEL_PRESETS[value as Channel];
    setForm((f) => ({
      ...f,
      channel: value,
      commissionRate: String(preset.commissionRate),
      platformFeeRate: String(preset.platformFeeRate),
      marketingRate: String(preset.marketingRate),
    }));
    setResult(null);
  };

  // ── TASK-012: 保存情景 ──
  const handleSaveScenario = async () => {
    if (!result || !onSaveScenario) return;
    if (!scenarioName.trim()) {
      setSaveMsg("请填写情景名称");
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      await onSaveScenario({
        scenarioName: scenarioName.trim(),
        costInput: {
          materialCost: Number(form.materialCost),
          packagingCost: Number(form.packagingCost),
          manufacturingCost: Number(form.manufacturingCost),
          certificationCost: Number(form.certificationCost),
          monthlyFixed: Number(form.monthlyFixed),
          retailPrice: Number(form.retailPrice),
          channel: form.channel as Channel,
          invoiceType: form.invoiceType as InvoiceType,
          commissionRate: Number(form.commissionRate),
          platformFeeRate: Number(form.platformFeeRate),
          marketingRate: Number(form.marketingRate),
          expressType: form.expressType as ExpressType,
          marketReferencePrice: form.marketReferencePrice ? Number(form.marketReferencePrice) : undefined,
          targetMarginRate: form.targetMarginRate ? Number(form.targetMarginRate) : undefined,
        },
        sourceStatus: scenarioSourceStatus,
        unit: "件",
        currency: currency || "CNY",
        expenseBase: "出厂口径",
      });
      setSaveMsg("已保存");
      setScenarioName("");
    } catch {
      setSaveMsg("保存失败");
    } finally {
      setSaving(false);
    }
  };

  // ── TASK-012: 从已保存情景恢复表单 ──
  // 真回填：把保存时的 costInput 写回表单并当场复算。
  // 拿不到 costInput 时必须说清楚没载入 —— 只弹一句「已加载」而表单还是上一次的输入，
  // 会让接下来算出的每个数字都被归到错的情景名下。
  const loadScenario = (scenario: SavedScenario) => {
    const input = scenario.costInput;
    if (!input) {
      setError(null);
      setSaveMsg(
        `「${scenario.scenarioName}」没有保存输入明细，无法回填表单。可按当前输入重新计算并另存一版。`
      );
      return;
    }
    const str = (v: number | undefined | null): string =>
      v === undefined || v === null || Number.isNaN(v) ? "" : String(v);
    const channel = (input.channel ?? form.channel) as Channel;
    const preset = CHANNEL_PRESETS[channel] ?? CHANNEL_PRESETS.XINXUAN;
    setForm({
      materialCost: str(input.materialCost),
      packagingCost: str(input.packagingCost),
      manufacturingCost: str(input.manufacturingCost),
      certificationCost: str(input.certificationCost),
      monthlyFixed: str(input.monthlyFixed),
      retailPrice: str(input.retailPrice),
      channel,
      invoiceType: (input.invoiceType ?? form.invoiceType) as string,
      expressType: (input.expressType ?? form.expressType) as string,
      commissionRate: str(input.commissionRate ?? preset.commissionRate),
      platformFeeRate: str(input.platformFeeRate ?? preset.platformFeeRate),
      marketingRate: str(input.marketingRate ?? preset.marketingRate),
      marketReferencePrice: str(input.marketReferencePrice),
      targetMarginRate: str(input.targetMarginRate),
    });
    setError(null);
    // 复算用回填后的输入，不用 state（setForm 这一轮还没生效）。
    const required: Array<keyof CostInput> = [
      "materialCost",
      "packagingCost",
      "manufacturingCost",
      "certificationCost",
      "monthlyFixed",
      "retailPrice",
    ];
    const complete = required.every(
      (k) => typeof input[k] === "number" && Number.isFinite(input[k] as number)
    );
    if (!complete) {
      setResult(null);
      setSaveMsg(
        `已回填「${scenario.scenarioName}」的输入，但其中有缺项，补齐后再点「计算」。`
      );
      return;
    }
    setResult(calcCost(applyDefaults({ ...(input as CostInput), channel })));
    setSaveMsg(`已载入「${scenario.scenarioName}」的输入并复算。`);
  };

  // ── TASK-012: 对比模式切换 ──
  const toggleCompareMode = () => {
    setCompareMode(!compareMode);
    setSelectedScenarios([]);
  };

  // ── TASK-012: 选择/取消选择情景 ──
  const toggleScenarioSelection = (artifactId: string) => {
    setSelectedScenarios((prev) => {
      if (prev.includes(artifactId)) return prev.filter((id) => id !== artifactId);
      if (prev.length >= 2) return [prev[1], artifactId];
      return [...prev, artifactId];
    });
  };

  const compute = () => {
    setError(null);
    const num = (k: string): number | null => {
      const raw = form[k];
      if (raw === undefined || raw.trim() === "") return null;
      const v = Number(raw);
      return Number.isFinite(v) ? v : null;
    };

    for (const f of REQUIRED_FIELDS) {
      const v = num(f.key as string);
      if (v === null) {
        setError(`请填写「${f.label}」。`);
        return;
      }
    }

    const input: CostInput = {
      materialCost: num("materialCost")!,
      packagingCost: num("packagingCost")!,
      manufacturingCost: num("manufacturingCost")!,
      certificationCost: num("certificationCost")!,
      monthlyFixed: num("monthlyFixed")!,
      retailPrice: num("retailPrice")!,
      channel: form.channel as Channel,
      invoiceType: form.invoiceType as InvoiceType,
      commissionRate: num("commissionRate") ?? CHANNEL_PRESETS[form.channel as Channel].commissionRate,
      platformFeeRate: num("platformFeeRate") ?? CHANNEL_PRESETS[form.channel as Channel].platformFeeRate,
      marketingRate: num("marketingRate") ?? CHANNEL_PRESETS[form.channel as Channel].marketingRate,
      expressType: form.expressType as ExpressType,
    };
    const mrp = num("marketReferencePrice");
    if (mrp !== null) input.marketReferencePrice = mrp;
    const tmr = num("targetMarginRate");
    if (tmr !== null) input.targetMarginRate = tmr;

    setResult(calcCost(applyDefaults(input)));
  };

  // 预算对照用 BOM 成本（L1–L4，产品本身成本）；targetCost 为「产品成本上限」口径，
  // 已由竞品价扣除渠道佣金/售后反推得到，故不与含渠道费的单件总成本（L1–L5）比较。
  const hasTarget = targetCost !== null && targetCost !== undefined;
  const targetNum = hasTarget ? Number(targetCost) : null;
  const overBudget = result && targetNum !== null ? result.totalBomCost > targetNum : null;

  return (
    <div className="hermes-stack">
      {/* ── 成本结论（第三层：先给结果 + 主要来源，明细收起） ── */}
      <section className="hermes-theme-section">
        <div className="hermes-theme-head">
          <h2 className="hermes-theme-title">成本结论</h2>
          {result && (
            <Badge tone={overBudget ? "danger" : "ok"}>
              {overBudget ? "超出产品成本上限" : "在产品成本上限内"}
            </Badge>
          )}
        </div>

        {!result ? (
          <p className="hermes-theme-conclusion">
            录入成本输入后，由确定性引擎实时计算单件成本（L1–L5）、毛利率与供货价区间。
            无真实输入时不估算、不编造利润率。
          </p>
        ) : (
          <>
            <p className="hermes-theme-conclusion">
              按当前输入口径，单件总成本（L1–L5，不含税） <strong>{money(result.totalCost)}</strong>
              （BOM 毛利率 {pct(result.bomMarginRate)}，净利率 {pct(result.netMarginRate)}）。
              保底供货价 {money(result.supplyPriceFloor)}，建议供货价 {money(result.supplyPriceSuggested)}。
            </p>
            <KV
              items={[
                { k: "单件总成本（L1–L5，不含税）", v: money(result.totalCost) },
                { k: "其中 BOM 成本（L1–L4，含损耗）", v: money(result.totalBomCost) },
                { k: "BOM 毛利率", v: pct(result.bomMarginRate) },
                { k: "净利率", v: pct(result.netMarginRate) },
                { k: "盈亏平衡量", v: `${result.breakevenUnits} 件/月` },
                { k: "保底供货价", v: money(result.supplyPriceFloor) },
                { k: "建议供货价", v: money(result.supplyPriceSuggested) },
                { k: "月固定成本（L6，月，不计入单件）", v: money(result.layer6Allocation) },
              ]}
            />
            {hasTarget && targetNum !== null && (
              <p className={cx("hermes-note", overBudget && "is-alert")} style={{ marginTop: 10 }}>
                产品成本上限（{versionTag ?? "当前版本"}）{money(targetNum)} {currency || ""}
                ，对照 BOM 成本（L1–L4，材料+包装+制造+物流，不含渠道佣金/售后）{money(result.totalBomCost)}：
                {overBudget
                  ? ` 超出 ${money(result.totalBomCost - targetNum)}，需压成本或上调售价。`
                  : ` 在预算内，余量 ${money(targetNum - result.totalBomCost)}。`}
              </p>
            )}
          </>
        )}
      </section>

      {/* ── 成本输入 ── */}
      <section className="hermes-theme-section">
        <div className="hermes-theme-head">
          <h2 className="hermes-theme-title">成本输入</h2>
        </div>
        <div className="hermes-form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {REQUIRED_FIELDS.map((f) => (
            <label key={f.key as string} className="hermes-label">
              {f.label}
              <input
                className="hermes-input"
                type="number"
                inputMode="decimal"
                step={f.step}
                value={form[f.key as string] ?? ""}
                placeholder="0.00"
                onChange={(e) => setField(f.key as string, e.target.value)}
              />
              {f.hint && <span className="hermes-note">{f.hint}</span>}
            </label>
          ))}

          <label className="hermes-label">
            渠道
            <select className="hermes-select" value={form.channel} onChange={(e) => onChannelChange(e.target.value)}>
              {CHANNEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="hermes-note">{CHANNEL_PRESETS[form.channel as Channel]?.description}</span>
          </label>

          <label className="hermes-label">
            发票类型
            <select
              className="hermes-select"
              value={form.invoiceType}
              onChange={(e) => setField("invoiceType", e.target.value)}
            >
              {INVOICE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="hermes-note">{INVOICE_PRESETS[form.invoiceType as InvoiceType]?.description}</span>
          </label>

          <label className="hermes-label">
            快递类型
            <select
              className="hermes-select"
              value={form.expressType}
              onChange={(e) => setField("expressType", e.target.value)}
            >
              {EXPRESS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="hermes-note">{EXPRESS_PRESETS[form.expressType as ExpressType]?.description}</span>
          </label>

          <label className="hermes-label">
            达人佣金率 %（可覆盖预设）
            <input
              className="hermes-input"
              type="number"
              inputMode="decimal"
              step="0.1"
              value={form.commissionRate}
              onChange={(e) => setField("commissionRate", e.target.value)}
            />
          </label>
          <label className="hermes-label">
            平台服务费率 %（可覆盖预设）
            <input
              className="hermes-input"
              type="number"
              inputMode="decimal"
              step="0.1"
              value={form.platformFeeRate}
              onChange={(e) => setField("platformFeeRate", e.target.value)}
            />
          </label>
          <label className="hermes-label">
            推广费率 %（可覆盖预设）
            <input
              className="hermes-input"
              type="number"
              inputMode="decimal"
              step="0.1"
              value={form.marketingRate}
              onChange={(e) => setField("marketingRate", e.target.value)}
            />
          </label>
          <label className="hermes-label">
            市场参考价（元，可选）
            <input
              className="hermes-input"
              type="number"
              inputMode="decimal"
              step="0.01"
              value={form.marketReferencePrice}
              placeholder="用于顶价锚定"
              onChange={(e) => setField("marketReferencePrice", e.target.value)}
            />
          </label>
          <label className="hermes-label">
            目标利润率 %（可选）
            <input
              className="hermes-input"
              type="number"
              inputMode="decimal"
              step="1"
              value={form.targetMarginRate}
              placeholder="默认 30"
              onChange={(e) => setField("targetMarginRate", e.target.value)}
            />
          </label>
        </div>

        {error && (
          <div className="hermes-banner is-danger" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}

        <div className="hermes-inline" style={{ marginTop: 14 }}>
          <button className="hermes-primary-btn hermes-btn-sm" onClick={compute}>
            <Icon name="play" size={13} />
            计算经济性
          </button>
          <span className="hermes-note">所有数值由确定性引擎算出，不调用模型。</span>
        </div>

        {/* ── TASK-012: 保存情景 ── */}
        {result && onSaveScenario && (
          <div className="hermes-inline" style={{ marginTop: 14, flexWrap: "wrap", gap: 8 }}>
            <input
              className="hermes-input"
              type="text"
              placeholder="情景名称（如 基础情景 / 保守情景）"
              value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
              style={{ width: 220 }}
            />
            <select
              className="hermes-select"
              value={scenarioSourceStatus}
              onChange={(e) => setScenarioSourceStatus(e.target.value as "DRAFT" | "ACTIVE" | "ARCHIVED")}
            >
              <option value="DRAFT">草稿</option>
              <option value="ACTIVE">生效</option>
              <option value="ARCHIVED">归档</option>
            </select>
            <button
              className="hermes-primary-btn hermes-btn-sm"
              onClick={handleSaveScenario}
              disabled={saving || !scenarioName.trim()}
            >
              {saving ? "保存中…" : "保存情景"}
            </button>
            {saveMsg && <span className="hermes-note">{saveMsg}</span>}
          </div>
        )}

        {/* ── TASK-012: 已保存情景列表 + 对比 ── */}
        {savedScenarios && savedScenarios.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="hermes-inline" style={{ marginBottom: 8, gap: 8 }}>
              <span className="hermes-note" style={{ fontWeight: 600 }}>已保存情景</span>
              <button
                className="hermes-btn hermes-btn-sm"
                onClick={toggleCompareMode}
              >
                {compareMode ? "退出对比" : "对比情景"}
              </button>
            </div>
            <div className="hermes-list">
              {savedScenarios.map((s) => (
                <div
                  key={s.artifactId}
                  className={cx(
                    "hermes-row",
                    compareMode && selectedScenarios.includes(s.artifactId) && "is-selected"
                  )}
                  style={{
                    cursor: compareMode ? "pointer" : "default",
                    border: compareMode && selectedScenarios.includes(s.artifactId)
                      ? "1px solid var(--hermes-primary)"
                      : undefined,
                  }}
                  onClick={() => {
                    if (compareMode) {
                      toggleScenarioSelection(s.artifactId);
                    } else {
                      loadScenario(s);
                    }
                  }}
                >
                  <div className="hermes-row-head">
                    <span className="hermes-row-title">{s.scenarioName}</span>
                    <Badge tone={s.sourceStatus === "ACTIVE" ? "ok" : s.sourceStatus === "DRAFT" ? "warn" : "neutral"}>
                      {s.sourceStatus === "ACTIVE" ? "生效" : s.sourceStatus === "DRAFT" ? "草稿" : "归档"}
                    </Badge>
                    <span className="hermes-note">v{s.contentVersion}</span>
                  </div>
                  <KV
                    items={[
                      { k: "总成本", v: `¥${s.result.toFixed(2)}` },
                      { k: "净利润", v: `¥${s.netProfit.toFixed(2)}` },
                      { k: "引擎版本", v: s.engineVersion },
                    ]}
                  />
                </div>
              ))}
            </div>

            {/* ── TASK-012: 对比结果 ── */}
            {compareMode && selectedScenarios.length === 2 && (
              <div className="hermes-theme-section" style={{ marginTop: 12 }}>
                <div className="hermes-theme-head">
                  <h3 className="hermes-theme-title">情景对比</h3>
                </div>
                {(() => {
                  const left = savedScenarios.find((s) => s.artifactId === selectedScenarios[0]);
                  const right = savedScenarios.find((s) => s.artifactId === selectedScenarios[1]);
                  if (!left || !right) return <Empty>请选择两个情景进行对比</Empty>;
                  return (
                    <table className="hermes-table">
                      <thead>
                        <tr>
                          <th>指标</th>
                          <th>{left.scenarioName}</th>
                          <th>{right.scenarioName}</th>
                          <th>差异</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>总成本</td>
                          <td>¥{left.result.toFixed(2)}</td>
                          <td>¥{right.result.toFixed(2)}</td>
                          <td>{(right.result - left.result) >= 0 ? "+" : ""}{(right.result - left.result).toFixed(2)}</td>
                        </tr>
                        <tr>
                          <td>净利润</td>
                          <td>¥{left.netProfit.toFixed(2)}</td>
                          <td>¥{right.netProfit.toFixed(2)}</td>
                          <td>{(right.netProfit - left.netProfit) >= 0 ? "+" : ""}{(right.netProfit - left.netProfit).toFixed(2)}</td>
                        </tr>
                        <tr>
                          <td>来源状态</td>
                          <td>{left.sourceStatus}</td>
                          <td>{right.sourceStatus}</td>
                          <td>{left.sourceStatus !== right.sourceStatus ? "不同" : "—"}</td>
                        </tr>
                        <tr>
                          <td>引擎版本</td>
                          <td>{left.engineVersion}</td>
                          <td>{right.engineVersion}</td>
                          <td>{left.engineVersion !== right.engineVersion ? "不同" : "—"}</td>
                        </tr>
                      </tbody>
                    </table>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── 单件成本明细与税费（第四层：主动展开） ── */}
      {result && (
        <>
          <section className="hermes-theme-section">
            <div className="hermes-theme-head">
              <h2 className="hermes-theme-title">单件成本明细（L1–L5，不含税）</h2>
            </div>
            <table className="hermes-table">
              <thead>
                <tr>
                  <th>层级</th>
                  <th>金额</th>
                </tr>
              </thead>
              <tbody>
                {LAYER_ROWS.map((r) => (
                  <tr key={r.key as string}>
                    <td>{r.label}</td>
                    <td>{money(Number(result[r.key]))}</td>
                  </tr>
                ))}
                <tr className="is-sum">
                  <td>单件总成本（L1–L5）</td>
                  <td>{money(result.totalCost)}</td>
                </tr>
                <tr>
                  <td>其中 BOM 成本（L1–L4，含损耗）</td>
                  <td>{money(result.totalBomCost)}</td>
                </tr>
                <tr>
                  <td>其中 渠道成本合计（L5）</td>
                  <td>{money(result.totalChannelCost)}</td>
                </tr>
              </tbody>
            </table>
            <p className="hermes-note" style={{ marginTop: 10 }}>
              L6 月固定成本 {money(result.layer6Allocation)}/月（团队工资/房租等）不计入单件成本，
              仅用于盈亏平衡量 {result.breakevenUnits} 件/月；月固定成本不是采购进项，不参与进项税抵扣。
            </p>
          </section>

          <section className="hermes-theme-section">
            <div className="hermes-theme-head">
              <h2 className="hermes-theme-title">税费与利润</h2>
            </div>
            <table className="hermes-table">
              <tbody>
                {TAX_ROWS.map((r) => (
                  <tr key={r.key as string}>
                    <td>{r.label}</td>
                    <td>{money(Number(result[r.key]))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="hermes-theme-section">
            <div className="hermes-theme-head">
              <h2 className="hermes-theme-title">供货价区间</h2>
            </div>
            <table className="hermes-table">
              <tbody>
                {SUPPLY_ROWS.map((r) => (
                  <tr key={r.key as string}>
                    <td>{r.label}</td>
                    <td>{money(Number(result[r.key]))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="hermes-theme-section">
            <div className="hermes-theme-head">
              <h2 className="hermes-theme-title">自检告警</h2>
              {result.alerts.length === 0 ? (
                <Badge tone="ok">无</Badge>
              ) : (
                <Badge tone={result.alerts.some((a) => a.severity === "ERROR") ? "danger" : "warn"}>
                  {result.alerts.length} 条
                </Badge>
              )}
            </div>
            {result.alerts.length === 0 ? (
              <Empty>引擎未检出阻断性或需关注项。</Empty>
            ) : (
              <div className="hermes-list">
                {result.alerts.map((a) => (
                  <div key={a.id} className="hermes-row">
                    <div className="hermes-row-head">
                      <span className="hermes-row-title">{a.msg}</span>
                      <Badge tone={a.severity === "ERROR" ? "danger" : a.severity === "WARN" ? "warn" : "neutral"}>
                        {a.severity}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
