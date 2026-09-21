"use client";

import React from "react";
import { Panel, Badge, Empty, Thinking, cx } from "@/components/ui";
import Icon from "@/components/icons";
import { fmtDateTime } from "@/shared/datetime";

/**
 * 多轮优化面板（蓝图 §4.4）
 *
 * 流程：v1 分析 → 展示主要弱项 → 提出修改草案 → 用户选择采纳项 → 创建 v2
 *      → 对受影响维度重评 → 显示变更前后与代价 → 进入下一轮
 *
 * 刻意不做的事（避免误导）：
 * - 不预测"改完能得多少分"。采纳项只声明改哪个字段、影响哪些维度；
 *   分数变化以重评结果为准。
 * - 不把「改文案」包装成「补证据」。分析维度若读的是已核实证据，
 *   面板会明确标注「改文案不会改变该维度结论」。
 * - 不静默覆盖。若产品已产生更新版本，服务端会拒绝并提示重新生成草案。
 */

const STATUS_TEXT: Record<string, string> = {
  improved: "提升",
  declined: "下降",
  unchanged: "持平",
  still_unknown: "仍未知",
  newly_known: "本轮首次有依据",
};

/**
 * 采纳并创建新版本的实际链路：校验基线 → 写新版本 → 重评受影响维度 → 生成前后对比。
 * 供进行态如实说明「这次会做什么」；**不表示完成进度**，故不标已完成、不画百分比。
 */
const REVISION_STEPS = [
  "校验基线版本仍是最新（已过期则拒绝本次提交）",
  "写入新版本，旧版本与其分析结果原样保留",
  "对受影响维度重新评分（确定性规则，未调用模型）",
  "生成变更前后对比与代价清单",
];

export default function RevisionPanel({
  productId,
  onChanged,
}: {
  productId: string;
  onChanged: () => void;
}) {
  const [loading, setLoading] = React.useState(true);
  const [data, setData] = React.useState<any>(null);
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<any>(null);
  const [comparison, setComparison] = React.useState<any>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/products/${productId}/revisions`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "读取可采纳项失败");
      setData(json);
    } catch (e: any) {
      setErr(e.message || "读取失败");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  React.useEffect(() => {
    load();
  }, [load]);

  /**
   * 勾选采纳项时把「当前值」预填进输入框，用户可在其上修改。
   * 不预填 placeholder 文本 —— 那会把提示语误当成真实取值写进版本。
   */
  const toggle = (opt: any) => {
    const key: string = String(opt.key);
    setSelected((prev) => {
      const next: Record<string, boolean> = { ...prev, [key]: !prev[key] };
      if (next[key]) {
        setValues((v) => {
          const merged = { ...v };
          for (const t of opt.targets) {
            if (merged[t.field] === undefined) merged[t.field] = t.currentValue ?? "";
          }
          return merged;
        });
      }
      return next;
    });
  };

  const submit = async () => {
    const adopted = (data?.options ?? []).filter((o: any) => selected[o.key]);
    if (adopted.length === 0) {
      setErr("请至少勾选一项要采纳的改动");
      return;
    }
    const changes: Record<string, string> = {};
    for (const o of adopted) {
      for (const t of o.targets) {
        const v = values[t.field];
        if (v !== undefined && v !== "") changes[t.field] = v;
      }
    }
    if (Object.keys(changes).length === 0) {
      setErr("勾选项里没有填入任何新值，未产生实际变化");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/products/${productId}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseVersionId: data.baseVersion.id,
          adoptedKeys: adopted.map((o: any) => o.key),
          changes,
          note: note.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "创建新版本失败");
      setResult(json);

      // 变更前后对比：用返回的上一轮 run 与本轮 run 精确对比，不拿"最新"当"变更前"
      if (json.previousRunId && json.analysisRunId) {
        const cmp = await fetch(
          `/api/products/${productId}/revisions/compare?before=${json.previousRunId}&after=${json.analysisRunId}`
        );
        const cmpJson = await cmp.json();
        if (cmp.ok) setComparison(cmpJson);
      }

      setSelected({});
      setValues({});
      setNote("");
      await load(); // 刷新版本轨迹与可采纳项
      onChanged();
    } catch (e: any) {
      setErr(e.message || "创建新版本失败");
    } finally {
      setBusy(false);
    }
  };

  const options: any[] = data?.options ?? [];
  const history: any[] = data?.history ?? [];
  const nextTag = (() => {
    const m = /^v(\d+)$/.exec(data?.baseVersion?.versionTag ?? "");
    return m ? `v${Number(m[1]) + 1}` : "下一版本";
  })();

  // 选择摘要：勾完不必回读整张列表，就知道这次要改哪些字段、动到哪些维度。
  const adoptedOptions: any[] = options.filter((o: any) => selected[o.key]);
  const adoptedFields: string[] = adoptedOptions.flatMap((o: any) => (o.targets ?? []).map((t: any) => t.label));
  const adoptedDimLabels: string[] = Array.from(
    new Set(adoptedOptions.flatMap((o: any) => (o.affectedDimensions ?? []).map((d: any) => d.label))),
  ) as string[];

  return (
    <div className="hermes-stack">
      {err && <div className="hermes-banner is-danger">{err}</div>}

      <Panel
        eyebrow="REVISION"
        icon="edit"
        title="可采纳的修改草案"
        titleSmall={options.length > 0 ? `(${options.length})` : undefined}
        sub="由最新分析缺口推导；只声明改哪个字段、影响哪些维度，不承诺分数上升。标「采纳后该维度会重算」的项会重新打分，其余为文案级改动、不改变该维度结论。"
      >
        {loading ? (
          <Thinking label="正在读取最新分析与版本状态…" />
        ) : !data?.baseVersion ? (
          <Empty>该产品还没有版本，无法生成修改草案。</Empty>
        ) : options.length === 0 ? (
          <Empty>{data.note || "当前没有可转化为方案改动的缺口。"}</Empty>
        ) : (
          <div className="hermes-list">
            {options.map((o: any) => (
              <div key={o.key} className={cx("hermes-row", selected[o.key] && "is-selected")}>
                <div className="hermes-row-head">
                  <label className="hermes-inline" style={{ cursor: "pointer", gap: 9 }}>
                    <input
                      type="checkbox"
                      checked={!!selected[o.key]}
                      onChange={() => toggle(o)}
                      aria-label={`采纳：${o.title}`}
                    />
                    <span className="hermes-row-title">{o.title}</span>
                  </label>
                  <span className="hermes-inline">
                    <Badge tone="info">{o.dimensionLabel}</Badge>
                    {o.mayMoveScore && <Badge tone="warn">采纳后该维度会重算</Badge>}
                  </span>
                </div>
                {/* 结构化明细：缺口 / 建议 / 影响 / 代价 各占一格、各带标签。
                    上一版把三项挤成一行 13px 流水句，读起来像日志。 */}
                <div className="hermes-rev-detail">
                  <div>
                    <span className="hermes-section-label">缺口</span>
                    <p>{o.reason}</p>
                  </div>
                  {o.recommendation && (
                    <div>
                      <span className="hermes-section-label">建议</span>
                      <p>{o.recommendation}</p>
                    </div>
                  )}
                  <div>
                    <span className="hermes-section-label">影响</span>
                    <p>{o.affectedDimensions.map((d: any) => d.label).join("、")}</p>
                  </div>
                  <div>
                    <span className="hermes-section-label">代价</span>
                    <p>{o.costNote}</p>
                  </div>
                </div>

                {selected[o.key] && (
                  <div className="hermes-form-grid" style={{ marginTop: 12 }}>
                    {o.targets.map((t: any) => (
                      <label key={t.field} className="hermes-label">
                        {t.label}
                        <input
                          className="hermes-input"
                          value={values[t.field] ?? ""}
                          placeholder={t.placeholder}
                          onChange={(e) => setValues((v) => ({ ...v, [t.field]: e.target.value }))}
                        />
                        <span className="hermes-note">
                          当前：{t.currentValue ?? "未设置（保持未知，不补造）"}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {options.length > 0 && (
          <div className="hermes-rev-foot">
            {/* 选择摘要：勾完不必回读列表就知道这次要改什么、动到哪些维度 */}
            <p className="hermes-note">
              {adoptedOptions.length === 0
                ? "尚未勾选任何改动。"
                : `已选 ${adoptedOptions.length} 项 · 改动字段 ${adoptedFields.join("、")} · 涉及维度 ${adoptedDimLabels.join("、") || "无"}`}
            </p>
            <label className="hermes-label">
              本轮修改理由（写入版本留痕，必填以便日后追溯）
              <textarea
                className="hermes-textarea"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例如：根据渠道反馈把价格预期下调，先跑一轮毛利口径"
              />
            </label>
            <div className="hermes-inline-end">
              <button className="hermes-primary-btn" onClick={submit} disabled={busy || note.trim().length === 0}>
                <Icon name="arrow" size={15} />
                {busy ? "正在创建…" : `采纳并创建 ${nextTag}`}
              </button>
            </div>
            {/* 状态透明：提交期间如实说明这次会做什么（步骤 ≠ 进度百分比） */}
            {busy && (
              <Thinking
                label="正在创建新版本并重评受影响维度…"
                hint="本次执行的步骤（不调用模型）"
                steps={REVISION_STEPS}
              />
            )}
            <p className="hermes-note">
              创建新版本不会覆盖 {data?.baseVersion?.versionTag ?? "旧版本"}；旧版本与其分析结果原样保留。
              若产品在此期间已产生更新版本，本次提交会被拒绝，需要基于最新版本重新生成草案。
            </p>
          </div>
        )}
      </Panel>

      {result && (
        <Panel
          eyebrow="RESULT"
          title={`已创建 ${result.versionTag}`}
          sub={`基于 ${result.supersedesVersionTag}；旧版本未被覆盖，历史分析轮次仍可查`}
        >
          <div className="hermes-section-label">字段变更</div>
          <table className="hermes-table">
            <thead>
              <tr>
                <th>字段</th>
                <th>变更前</th>
                <th>变更后</th>
              </tr>
            </thead>
            <tbody>
              {result.diff
                .filter((d: any) => d.changed)
                .map((d: any) => (
                  <tr key={d.field}>
                    <td>{d.label}</td>
                    <td className="muted-line">{d.before ?? "未设置"}</td>
                    <td>{d.after ?? "未设置"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="hermes-note" style={{ marginTop: 10 }}>
            影响维度：{result.affectedDimensions.map((d: any) => d.label).join("、") || "无"} · 已自动对受影响维度重评
            （规则合成，未调用模型）
          </p>
        </Panel>
      )}

      {comparison && (
        <Panel
          eyebrow="BEFORE / AFTER"
          title="变更前后与代价"
          sub={`${comparison.before.versionTag}（${comparison.before.kind}）→ ${comparison.after.versionTag}（${comparison.after.kind}）`}
        >
          <table className="hermes-table">
            <thead>
              <tr>
                <th>维度</th>
                <th>变更前</th>
                <th>变更后</th>
                <th>变化</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {comparison.dimensions.map((d: any) => (
                <tr key={d.key}>
                  <td>{d.label}</td>
                  <td className="muted-line">{d.before ?? "未知"}</td>
                  <td>{d.after ?? "未知"}</td>
                  <td>
                    {d.delta === null ? (
                      <Badge tone="neutral">{STATUS_TEXT[d.status]}</Badge>
                    ) : d.delta > 0 ? (
                      <Badge tone="ok">+{d.delta}</Badge>
                    ) : d.delta < 0 ? (
                      <Badge tone="danger">{d.delta}</Badge>
                    ) : (
                      <Badge tone="neutral">0</Badge>
                    )}
                  </td>
                  <td className="muted-line">{d.afterGaps || d.beforeGaps || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="hermes-section-label" style={{ marginTop: 16 }}>
            变化代价
          </div>
          {comparison.costs.length === 0 ? (
            <p className="hermes-note">本轮改动未触发已记录的代价项。</p>
          ) : (
            <ul className="hermes-note" style={{ paddingLeft: 18, lineHeight: 1.9 }}>
              {comparison.costs.map((c: string, i: number) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}

          <p className="hermes-note" style={{ marginTop: 10 }}>
            综合：{comparison.before.weightedScore ?? "—"}（覆盖率{" "}
            {Math.round(comparison.before.coverageRatio * 100)}%{comparison.before.provisional ? "，暂评" : ""}）→{" "}
            {comparison.after.weightedScore ?? "—"}（覆盖率 {Math.round(comparison.after.coverageRatio * 100)}%
            {comparison.after.provisional ? "，暂评" : ""}）
          </p>
        </Panel>
      )}

      {/* 第四层：分析轮次轨迹只在主动查看时出现（分层信息设计 · 原始依据） */}
      <details className="hermes-details">
        <summary style={{ fontWeight: 600, padding: "4px 0" }}>
          查看分析轮次轨迹（{history.length}）· 历史结果不被最新覆盖
        </summary>
        <div style={{ marginTop: 12 }}>
          {history.length === 0 ? (
            <Empty>还没有分析轮次。</Empty>
          ) : (
            <table className="hermes-table">
              <thead>
                <tr>
                  <th>版本</th>
                  <th>类型</th>
                  <th>综合</th>
                  <th>覆盖率</th>
                  <th>规则</th>
                  <th>运行方式</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h: any) => (
                  <tr key={h.runId}>
                    <td>{h.versionTag}</td>
                    <td>{h.kind === "BASELINE" ? "基线" : "修订重评"}</td>
                    <td>
                      {h.weightedScore ?? "—"}
                      {h.provisional && <span className="muted-line"> 暂评</span>}
                    </td>
                    <td>{Math.round(h.coverageRatio * 100)}%</td>
                    <td>{h.ruleVersion}</td>
                    <td>{h.runMode === "MANUAL" ? "确定性规则" : h.runMode}</td>
                    <td className="muted-line">{fmtDateTime(h.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </details>
    </div>
  );
}
