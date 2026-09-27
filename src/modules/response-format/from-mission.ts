/**
 * MissionReport → ResponseEnvelope
 * ================================
 * 把现有 supervisor 报告翻译成排版信封，让 Display Layer 的结论卡走统一渲染路径。
 *
 * 设计原则（重要）：**宁可降级，不许编造。**
 * - 报告里没有成形的推荐/反对/风险三段 → 不生成 decision 块，信封降级为 ANSWER，
 *   而不是拿空数组硬凑一张决策卡骗过 R4。
 * - 报告里没有真实来源（P0-1 研究接入之前一直如此）→ 不生成 evidence 块，
 *   所有判断只能标 inference，并挂一条诚实 callout 说明"这次没有联网研究"。
 * - 这样 harness 的 R3 / R4 / R13 是真的在守门，而不是被适配器绕过去。
 */

import {
  conclusionLead,
  extractDecision,
  extractRecommendation,
  goalHeadline,
  type MissionReport,
  type ReportStep,
} from "../supervisor/report-format";
import type { Block, ResponseEnvelope } from "./types";

/** 从结论正文里抠出某个小节的条目（"主要风险"、"反对理由" 等）。 */
export function extractList(conclusion: string | null | undefined, heading: RegExp): string[] {
  if (!conclusion) return [];
  const lines = conclusion.replace(/\r/g, "").split("\n");
  const at = lines.findIndex((l) => heading.test(l));
  if (at < 0) return [];

  const out: string[] = [];
  // 行内形式：**主要风险**：a；b；c
  const head = lines[at];
  const inline = head.replace(heading, "").replace(/^[\s*_：:）)]+/, "").trim();
  if (inline) out.push(...inline.split(/[；;]\s*/).filter(Boolean));

  for (const l of lines.slice(at + 1)) {
    if (/^\s*#{1,6}\s/.test(l)) break;
    if (/^\s*\*\*[^*]+\*\*\s*[：:]/.test(l) && out.length) break;
    const m = /^\s*(?:[-•*]|\d+[.、)])\s*(.+)$/.exec(l);
    if (m) out.push(m[1].trim().replace(/\*\*/g, ""));
    else if (out.length && l.trim() === "") break;
  }
  return out.filter((x) => x.length > 0).slice(0, 8);
}

/** UNKNOWN 行 → 缺口清单。写不出"需要什么"的条目会被丢弃（R10 不接受空 needs）。 */
export function extractUnknowns(steps: ReportStep[]): { question: string; needs: string }[] {
  const out: { question: string; needs: string }[] = [];
  for (const s of steps) {
    for (const line of (s.output ?? "").split("\n")) {
      const m = /UNKNOWN[：:]\s*(.+)$/.exec(line);
      if (!m) continue;
      const body = m[1].trim().replace(/\*\*/g, "");
      // "X（需要 Y）" / "X — 需要 Y" / "X，需 Y"
      const split = /^(.*?)[（(—-]\s*需(?:要)?\s*(.+?)[）)]?$/.exec(body);
      if (split) out.push({ question: split[1].trim(), needs: split[2].trim() });
    }
  }
  return out.slice(0, 6);
}

const QA_STEP = /qa|复核|verifier/i;
const RED_STEP = /red.?team|红队/i;

function qaTrail(steps: ReportStep[]) {
  const trail: { verdict: "rej" | "fix" | "pass"; who: string; round: number; message: string }[] = [];
  for (const s of steps) {
    if (!QA_STEP.test(s.key) && !QA_STEP.test(s.label) && !RED_STEP.test(s.key)) continue;
    const out = (s.output ?? "").trim();
    if (!out) continue;
    const first = out.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").slice(0, 160) ?? "";
    const verdict = /REVISE|打回|不通过/.test(out) ? "rej" : /PASS|通过/.test(out) ? "pass" : "fix";
    trail.push({ verdict, who: s.agent || s.label, round: trail.length + 1, message: first });
  }
  return trail;
}

/** 步骤 → 进度块（全部已完成的终态视图，供结论卡的「过程」回看）。 */
function progressBlock(steps: ReportStep[]): Block {
  return {
    type: "progress",
    title: "团队做了什么",
    full: true,
    done: steps.filter((s) => s.status === "SUCCEEDED").length,
    total: steps.length,
    steps: steps.map((s) => ({
      key: s.key,
      label: s.label,
      agent: s.agent,
      state:
        s.status === "SUCCEEDED" ? "done"
        : s.status === "BLOCKED" ? "blocked"
        : s.status === "SKIPPED" ? "skipped"
        : "queued",
      delta: (s.output ?? "").split("\n").find((l) => l.trim() && !l.startsWith("#"))?.slice(0, 180),
    })),
  };
}

export interface FromMissionOptions {
  model: string;
  elapsedMs: number;
  quota: { used: number; limit: number | null } | null;
  /** 真实来源数；P0-1 接入前恒为 0。 */
  sources?: number;
}

export function envelopeFromMission(r: MissionReport, opts: FromMissionOptions): ResponseEnvelope {
  const recommend = extractList(r.conclusion, /结论与建议|推荐理由|关键依据/);
  const against = extractList(r.conclusion, /反对理由|不建议|反面/);
  const risks = extractList(r.conclusion, /主要风险|风险/);
  const decisionText = extractDecision(r.conclusion);
  const rec = extractRecommendation(r.conclusion);
  const unknowns = extractUnknowns(r.steps);
  const trail = qaTrail(r.steps);
  const sources = opts.sources ?? 0;

  const blocks: Block[] = [];

  if (r.constraints.length) {
    blocks.push({
      type: "prose",
      title: "已确认的约束",
      body: [r.constraints.map((c) => `**${c.question}**：${c.answer}`).join("　·　")],
    });
  }

  if (r.conclusion) {
    blocks.push({
      type: "prose",
      title: "结论",
      // 整段交给回复格式渲染器（Prose）：按空行切段会切断代码块和表格，
      // 截断段数会悄悄丢内容。
      body: [r.conclusion.replace(/\r/g, "").trim()],
    });
  }

  if (trail.length) blocks.push({ type: "qa", title: "QA 与红队", full: true, trail });
  if (r.steps.length) blocks.push(progressBlock(r.steps));

  if (unknowns.length) blocks.push({ type: "unknown", full: true, items: unknowns });

  // 决策卡：三段都拿得到才生成。拿不到就不装样子。
  const hasDecision = recommend.length > 0 && against.length > 0 && risks.length > 0;
  if (hasDecision) {
    blocks.push({
      type: "decision",
      title: "决策卡",
      headline: decisionText?.split("\n")[0].slice(0, 60) ?? rec ?? goalHeadline(r.goal).slice(0, 60),
      confidence: "MEDIUM",
      recommend,
      against,
      risks,
    });
  }

  if (sources === 0) {
    blocks.push({
      type: "callout",
      full: true,
      tone: "warn",
      title: "这次没有联网研究",
      body: r.demo
        ? "全部内容来自演示脚本。接入 ResearchRun 之后会替换为真实 SourceCapture 引用。"
        : "结论基于模型既有知识与你提供的上下文，没有外部来源可追溯；涉及数字的判断都按推断处理。",
    });
  }

  const lede =
    (rec ? `推荐做「${rec}」` : null) ??
    conclusionLead(r.conclusion, 58) ??
    goalHeadline(r.goal).slice(0, 58);

  return {
    v: 1,
    // 没有成形决策就不要谎称这是一次 CONCLUSION（R13 会拦）。
    kind: hasDecision ? "CONCLUSION" : "ANSWER",
    demo: r.demo,
    lede: lede.slice(0, 60),
    confidence: hasDecision ? "MEDIUM" : "LOW",
    blocks,
    ask: decisionText
      ? {
          question: decisionText.split("\n")[0].slice(0, 120),
          why_you: "这件事涉及预算、对外发布或不可逆操作，按治理规则必须由你拍板。",
          options: [
            { label: "批准，按计划推进", consequence: "团队继续执行，完成后回执到本对话" },
            { label: "先不做", consequence: "任务停在这里，随时说「继续」可以续跑" },
          ],
        }
      : undefined,
    meta: {
      model: opts.model,
      elapsedMs: opts.elapsedMs,
      steps: r.meta.tasksCreated,
      // 演示运行不占额度（R8）。
      quota: r.demo ? null : opts.quota,
      memoriesUsed: r.meta.memoriesUsed,
      sources,
    },
  };
}
