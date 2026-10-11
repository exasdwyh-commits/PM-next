/**
 * Executive Report 的「编辑式调研刊」版式。
 *
 * 内容在服务端渲染，打印工具独立为客户端组件。把 ExecutiveReportPayload
 * 映射成可独立阅读、可打印的报告：暖色纸面、衬线标题、结论侧栏、章节导航、
 * 可展开的专业明细与来源页脚。
 *
 * 防编造：所有内容都来自 payload。缺数据的分节不隐藏，而是如实渲染为
 * 「占位 / 怎么补齐」，并保留 UNKNOWN 与假设的显式标注。
 */
import type { ReactNode } from "react";
import type { ExecutiveReportPayload } from "@/shared/executive-report-types";
import { ReportToolbar } from "./report-toolbar";
import "./report-magazine.css";

export interface ReportMagazineMeta {
  title: string;
  contentVersion: number;
  reviewStatus: string;
  /** 已格式化好的生成时间（调用方用 shared/datetime 处理，避免时区漂移）。 */
  createdAtLabel: string;
}

type ClaimKey = "fact" | "infer" | "unknown";

const CLAIM_LABEL: Record<ClaimKey, string> = {
  fact: "事实",
  infer: "推断",
  unknown: "UNKNOWN",
};

/** 三态标注为系统级契约：呈现层只翻译，不发明。 */
function claimKind(kind?: string | null): ClaimKey {
  const k = (kind ?? "").toUpperCase();
  if (k === "FACT") return "fact";
  if (k === "INFERENCE" || k === "ESTIMATE") return "infer";
  return "unknown";
}

function reviewStatusLabel(status: string): string {
  switch (status.toUpperCase()) {
    case "PENDING":
      return "待评审";
    case "ACCEPTED":
      return "已采纳";
    case "REJECTED":
      return "已驳回";
    default:
      return status;
  }
}

function verificationLabel(status?: string | null): string {
  if (!status) return "未标注核验状态";
  switch (status.toUpperCase()) {
    case "READY_FOR_HUMAN_REVIEW":
      return "等待负责人复核";
    case "BLOCKED_BY_QA":
      return "独立 QA 未通过";
    default:
      return status;
  }
}

function fmtCount(n: number): string {
  return new Intl.NumberFormat("zh-CN").format(n);
}

/** 序号：A1、A2…（超过 26 条继续用 AA 之后无意义，报告上限 20 条）。 */
function rank(prefix: string, index: number): string {
  return `${prefix}${index + 1}`;
}

function Card({
  rk,
  title,
  tags,
  note,
  refs,
  state,
}: {
  rk: string;
  title: string;
  tags?: ReactNode;
  note?: ReactNode;
  refs?: string[];
  state?: "gap";
}) {
  return (
    <article className="rp-card" data-state={state}>
      <div className="rp-rank">{rk}</div>
      <div>
        <div className="rp-card-top">
          <h3>{title}</h3>
        </div>
        {tags ? <div className="rp-card-tags">{tags}</div> : null}
        {note ? <p className="rp-card-note">{note}</p> : null}
        {refs && refs.length > 0 ? (
          <div className="rp-refs">
            {refs.map((ref) => (
              <span className="rp-ref" key={ref}>
                {ref}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function SectionHead({
  index,
  title,
  desc,
}: {
  index: string;
  title: string;
  desc?: string;
}) {
  return (
    <header className="rp-section-head">
      <div className="rp-section-index">{index}</div>
      <div>
        <h2>{title}</h2>
        {desc ? <p>{desc}</p> : null}
      </div>
    </header>
  );
}

function StatusTag({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className="rp-tag" data-k={tone}>
      {children}
    </span>
  );
}

export function ReportMagazine({
  payload,
  meta,
}: {
  payload: ExecutiveReportPayload;
  meta: ReportMagazineMeta;
}) {
  const titleParts = meta.title.split(/\s+·\s+/);
  const titleDetail = titleParts.length > 1 && /报告$/.test(titleParts.at(-1) ?? "") ? titleParts.pop() : null;
  const displayTitle = titleDetail ? titleParts.join(" · ") : meta.title;
  const summary = payload.summary?.replace(/READY_FOR_HUMAN_REVIEW/g, "等待负责人复核").replace(/BLOCKED_BY_QA/g, "独立 QA 未通过");
  const conclusions = payload.conclusions ?? [];
  const unknowns = payload.unknowns ?? [];
  const risks = payload.risks ?? [];
  const decisions = payload.decisionsRequired ?? [];
  const actions = payload.recommendedActions ?? [];
  const assumptions = payload.assumptions ?? [];
  const notes = payload.advisoryNotes ?? [];
  const deep = payload.deepReport;
  const deepSections = deep?.sections ?? [];
  const bom = deep?.bom;
  const validation = deep?.validation;
  const provenance = payload.provenance;
  const sourceRefs = provenance?.sourceRefs ?? [];

  const verified = conclusions.filter((c) => (c.verificationRefs ?? []).length > 0).length;
  // 侧栏给的是「能不能引用」的判决，不重复 hero 的摘要：有结论就用第一条，没有就如实说没有。
  const headClaim = conclusions[0]?.claim ?? "尚未形成可以对外引用的结论。";
  const blockedByQa = (payload.verificationStatus ?? "").toUpperCase() === "BLOCKED_BY_QA";

  const facts: { label: string; value: string }[] = [
    { label: "依据", value: `${fmtCount(conclusions.length)} 条` },
    { label: "含核验记录", value: `${fmtCount(verified)} 条` },
    { label: "风险", value: `${fmtCount(risks.length)} 项` },
    { label: "UNKNOWN", value: `${fmtCount(unknowns.length)} 项` },
    { label: "待决策", value: `${fmtCount(decisions.length)} 项` },
  ];

  return (
    <div className="rp-root">
      <ReportToolbar />
      <div className="rp-sheet">
      <header className="rp-hero">
        <div className="rp-wrap rp-hero-grid">
          <div>
            <div className="rp-edition">产品研发报告 <span>v{meta.contentVersion} · {reviewStatusLabel(meta.reviewStatus)}</span></div>
            <h1>{displayTitle}</h1>
            {titleDetail ? <p className="rp-title-detail">{titleDetail}</p> : null}
            <p className="rp-dek">{summary || "报告没有提供总摘要，以下是逐条结论与缺口。"}</p>
          </div>
          <aside className="rp-verdict">
            <div className="rp-verdict-label">核验状态</div>
            <strong>{verificationLabel(payload.verificationStatus)}</strong>
            <p>{headClaim}</p>
            <p>
              {blockedByQa ? "独立 QA 尚未通过，请先处理核验缺口。" : "查看下方证据与缺口，再决定下一步。"}
            </p>
          </aside>
        </div>
      </header>

      <nav className="rp-bar" aria-label="报告数据条">
        <div className="rp-wrap rp-bar-inner">
          <div className="rp-facts">
            {facts.map((f) => (
              <span className="rp-fact" key={f.label} data-emphasis={f.label === "UNKNOWN" || f.label === "待决策" ? "accent" : undefined}>
                <span>{f.label}</span><strong>{f.value}</strong>
              </span>
            ))}
          </div>
          <div className="rp-stamp">生成于 {meta.createdAtLabel}</div>
        </div>
      </nav>

      <nav className="rp-toc rp-wrap" aria-label="报告章节">
        <a href="#report-conclusions">结论与依据</a>
        <a href="#report-risks">风险</a>
        <a href="#report-decisions">待决策</a>
        <a href="#report-gaps">资料缺口</a>
        <a href="#report-actions">下一步</a>
        <a href="#report-details">专业明细</a>
        <a href="#report-sources">来源与口径</a>
      </nav>
      <main>
        <section className="rp-section" id="report-conclusions">
          <div className="rp-wrap">
            <SectionHead
              index="A / 结论与依据"
              title="结论与依据"
              desc="先看结论，再查看事实属性、证据等级与核验记录。"
            />
            <div className="rp-list">
              {conclusions.length === 0 ? (
                <p className="rp-empty">尚无结论。请先补齐研究资料与核验记录。</p>
              ) : (
                conclusions.map((c, i) => (
                  <Card
                    key={`${c.claim}-${i}`}
                    rk={rank("A", i)}
                    title={c.claim}
                    tags={
                      <>
                        <StatusTag tone={claimKind(c.claimKind)}>{CLAIM_LABEL[claimKind(c.claimKind)]}</StatusTag>
                        <StatusTag tone={c.evidenceLevel ? "ok" : "warn"}>
                          证据等级 {c.evidenceLevel || "未标注"}
                        </StatusTag>
                        {(c.verificationRefs ?? []).length === 0 ? (
                          <StatusTag tone="warn">未核实</StatusTag>
                        ) : null}
                      </>
                    }
                    note={
                      <>
                        {c.evidenceRef ? (
                          <>
                            <b>依据：</b>
                            {c.evidenceRef}
                          </>
                        ) : null}
                        {c.freshness ? (
                          <>
                            {c.evidenceRef ? " · " : ""}
                            <b>时效：</b>
                            {c.freshness}
                          </>
                        ) : null}
                      </>
                    }
                    refs={c.verificationRefs}
                  />
                ))
              )}
            </div>
          </div>
        </section>

        <section className="rp-section" id="report-risks">
          <div className="rp-wrap">
            <SectionHead
              index="B / 风险"
              title="关键风险"
              desc="以下为报告登记的风险，需结合已有资料评估。"
            />
            <div className="rp-list">
              {risks.length === 0 ? (
                <p className="rp-empty">报告未登记风险条目。</p>
              ) : (
                risks.map((r, i) => (
                  <Card key={`${r}-${i}`} rk={rank("B", i)} title={r} tags={<StatusTag tone="risk">风险</StatusTag>} />
                ))
              )}
            </div>
          </div>
        </section>

        <section className="rp-section" id="report-decisions">
          <div className="rp-wrap">
            <SectionHead
              index="C / 待决策"
              title="需要你决定"
              desc="集中查看需要负责人确认的口径与取舍。"
            />
            <div className="rp-list">
              {decisions.length === 0 ? (
                <p className="rp-empty">报告没有列出需要负责人决定的事项。</p>
              ) : (
                decisions.map((d, i) => (
                  <Card key={`${d}-${i}`} rk={rank("C", i)} title={d} tags={<StatusTag tone="warn">待决策</StatusTag>} />
                ))
              )}
            </div>
          </div>
        </section>

        <section className="rp-section" id="report-gaps">
          <div className="rp-wrap">
            <SectionHead
              index="D / UNKNOWN 缺口"
              title="待补资料与未核实项"
              desc="以下内容仍缺输入或证据，补齐后可继续核验。"
            />
            <div className="rp-list">
              {unknowns.length === 0 ? (
                <p className="rp-empty">报告没有登记未闭合项。</p>
              ) : (
                unknowns.map((u, i) => (
                  <Card
                    key={`${u}-${i}`}
                    rk={rank("D", i)}
                    title={u}
                    state="gap"
                    tags={<StatusTag tone="unknown">UNKNOWN</StatusTag>}
                  />
                ))
              )}
            </div>
          </div>
        </section>

        <section className="rp-formula" id="report-actions">
          <div className="rp-wrap rp-formula-grid">
            <div>
              <div className="rp-edition">Next Actions</div>
              <h2>下一步行动</h2>
              <p className="rp-intro">
                按报告列出的顺序查看建议，优先补齐影响后续判断的资料。
              </p>
            </div>
            <div className="rp-equation">
              {actions.length === 0 ? (
                <div className="rp-equation-row">
                  <span>—</span>
                  <div>
                    <strong>报告未给出建议动作。</strong>
                  </div>
                </div>
              ) : (
                actions.map((a, i) => (
                  <div className="rp-equation-row" key={`${a}-${i}`}>
                    <span>ACTION {i + 1}</span>
                    <div>
                      <strong>{a}</strong>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="rp-playbook" id="report-details">
          <div className="rp-wrap">
            <details className="rp-deep-details">
            <summary><span><strong>专业明细与资料完整度</strong><small>查看规格、成本与验证各项的资料状态</small></span><span className="rp-disclosure" aria-hidden="true">＋</span></summary>
            <div className="rp-steps">
              {deepSections.length === 0 ? (
                <article className="rp-step">
                  <h3>尚无深度骨架</h3>
                  <p>这份报告没有携带九块结构，可能来自较早的执行批次。</p>
                </article>
              ) : (
                deepSections.map((s) => (
                  <article className="rp-step" key={s.key}>
                    <span className="rp-step-state">
                      <StatusTag tone={s.ready ? "ok" : "unknown"}>{s.ready ? "有内容" : "待补资料"}</StatusTag>
                    </span>
                    <h3>{s.title}</h3>
                    <p>{s.ready ? "已有内容，来源与核验情况请查看对应明细。" : s.gap || "缺数据，等待补输入。"}</p>
                  </article>
                ))
              )}
            </div>
            </details>
          </div>
        </section>

        {deep?.spec && deep.spec.rows.length > 0 ? (
          <section className="rp-section" id="report-spec">
            <div className="rp-wrap">
              <SectionHead
                index="E / 产品规格"
                title="产品定义与规格"
                desc={deep.spec.dosageForm ? `剂型：${deep.spec.dosageForm}` : "规格按报告原始记录展示。"}
              />
              <div className="rp-table-wrap" role="region" aria-label="产品规格表，可横向滚动" tabIndex={0}>
                <table className="rp-table">
                  <thead>
                    <tr>
                      <th scope="col">指标</th>
                      <th scope="col">规格</th>
                      <th scope="col">事实属性</th>
                      <th scope="col">依据</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deep.spec.rows.map((row, i) => (
                      <tr key={`${row.name}-${i}`}>
                        <td>{row.name || "—"}</td>
                        <td>{row.value || "—"} {row.unit}</td>
                        <td><StatusTag tone={claimKind(row.claimKind)}>{CLAIM_LABEL[claimKind(row.claimKind)]}</StatusTag></td>
                        <td>
                          {row.evidenceRef || "未提供来源"}
                          {row.note ? <small className="rp-cell-note">{row.note}</small> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : null}

        {bom && bom.lines.length > 0 ? (
          <section className="rp-section">
            <div className="rp-wrap">
              <SectionHead
                index="F / 配方与 BOM"
                title={`成本结构${bom.basis ? ` · ${bom.basis}` : ""}`}
                desc={`货币单位 ${bom.currency || "CNY"}。没有可追溯来源（sourceRef）的价格只作结构示意，不能用于报价。`}
              />
              <div className="rp-table-wrap" role="region" aria-label="成本结构表，可横向滚动" tabIndex={0}>
                <table className="rp-table">
                  <thead>
                    <tr>
                      <th>物料</th>
                      <th>数量</th>
                      <th>单位</th>
                      <th>单价</th>
                      <th>合计</th>
                      <th>来源</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bom.lines.map((line, i) => (
                      <tr key={`${line.item}-${i}`}>
                        <td>{line.item ?? "—"}</td>
                        <td>{line.qty ?? "—"}</td>
                        <td>{line.uom ?? "—"}</td>
                        <td>{line.unitCost ?? "—"}</td>
                        <td>{line.total ?? "—"}</td>
                        <td>{line.sourceRef ? <code>{line.sourceRef}</code> : "无来源（不可报价）"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : null}

        {validation ? (
          <section className="rp-section">
            <div className="rp-wrap">
              <SectionHead
                index="G / 验证计划"
                title={`断言核验台账${validation.qaStatus ? ` · ${verificationLabel(validation.qaStatus)}` : ""}`}
                desc="每条断言当前是否被证据支持；未核实的条目不会被写成已证实。"
              />
              {validation.items.length > 0 ? (
                <div className="rp-table-wrap" role="region" aria-label="断言核验表，可横向滚动" tabIndex={0}>
                  <table className="rp-table">
                    <thead>
                      <tr>
                        <th>断言</th>
                        <th>当前状态</th>
                        <th>事实属性</th>
                        <th>证据等级</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validation.items.map((item, i) => (
                        <tr key={`${item.claim}-${i}`}>
                          <td>{item.claim ?? "—"}</td>
                          <td>{item.latestStatus ?? "未核验"}</td>
                          <td>{CLAIM_LABEL[claimKind(item.claimKind)]}</td>
                          <td>{item.evidenceLevel || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rp-empty">验证台账里还没有条目。</p>
              )}
              {(validation.gaps ?? []).length > 0 ? (
                <details className="rp-inline-details">
                  <summary>查看核验缺口（{validation.gaps?.length ?? 0} 项）</summary>
                  <ul className="rp-plain">
                    {(validation.gaps ?? []).map((g, i) => (
                      <li key={`${g}-${i}`}>{g}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="rp-lanes">
          <div className="rp-wrap rp-lane-grid">
            <article className="rp-lane">
              <h3>假设 · 还没被证实的部分</h3>
              {assumptions.length === 0 ? (
                <p className="rp-empty">报告没有登记假设。</p>
              ) : (
                <ul>
                  {assumptions.map((a, i) => (
                    <li key={`${a}-${i}`}>{a}</li>
                  ))}
                </ul>
              )}
            </article>
            <article className="rp-lane">
              <details className="rp-advisory-details">
              <summary>专业执行说明 <span>{notes.length} 条</span></summary>
              {notes.length === 0 ? (
                <p className="rp-empty">没有特别说明。</p>
              ) : (
                <ul>
                  {notes.map((n, i) => (
                    <li key={`${n.agentCode}-${i}`}>
                      <strong>
                        {n.agentName || n.agentCode}
                        {n.status ? ` · ${n.status}` : ""}
                      </strong>
                      <br />
                      {n.summary || n.errorReason || "（无补充说明）"}
                    </li>
                  ))}
                </ul>
              )}
              </details>
            </article>
          </div>
        </section>

        <section className="rp-wrap rp-caution">
          <h2>别把留白读成「没问题」</h2>
          <p>
            {blockedByQa
              ? "独立 QA 尚未通过："
              : ""}
            这份报告里 {fmtCount(unknowns.length)} 个未闭合项、{fmtCount(assumptions.length)} 条假设、{fmtCount(risks.length)} 项风险都保留在原文位置上，
            仍需逐项复核。当前评审状态：{reviewStatusLabel(meta.reviewStatus)}；对外引用前请确认相关依据与核验结果。
          </p>
        </section>
      </main>

      <footer className="rp-notes" id="report-sources">
        <div className="rp-wrap">
          <details>
            <summary>数据口径与未核实项</summary>
            <p>
              本页数据来自产品研发综合评估的 Executive Report 成果（v{meta.contentVersion}）。核验状态：
              {verificationLabel(payload.verificationStatus)}。溯源引用 {fmtCount(sourceRefs.length)} 条证据、
              {fmtCount(provenance?.agentRunRefs?.length ?? 0)} 条执行记录，均按原样列出，未做二次加工。
            </p>
          </details>
          <details>
            <summary>怎么读这份报告</summary>
            <p>
              A 段回答「能引用什么」，B/C 段回答「要承担什么、要拍什么板」，D 段回答「还差什么」。
              标注为 UNKNOWN 的内容代表系统主动留白：没有可靠来源时不估算、不填充，等真实输入到位再更新。
            </p>
          </details>
          <div className="rp-sources">
            <h2>溯源</h2>
            <div className="rp-source-links">
              {sourceRefs.length === 0 ? (
                <span>无证据引用</span>
              ) : (
                sourceRefs.slice(0, 24).map((ref, i) => <span key={`${ref}-${i}`}>{ref}</span>)
              )}
            </div>
          </div>
        </div>
      </footer>
      </div>
      <div className="rp-endnote">Kern · 产品研发报告</div>
    </div>
  );
}

export default ReportMagazine;
