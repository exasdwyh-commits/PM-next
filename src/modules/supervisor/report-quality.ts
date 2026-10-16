/**
 * 研究报告质量门禁（R1·report-quality/v1）
 * ======================================
 * 把「这份报告能不能作为正式研究交付」写成可测试的判定，而不是靠提示词自觉：
 *
 * - 主题一致：正文必须围绕需求里的研究对象展开——需求说奶粉、结论讲海苔即阻断；
 * - 契约完整：复用 report-contract 的八节校验，缺节降级为待补证草稿；
 * - 约束覆盖：需求写明的人群 / 预算 / 主推要素要落进报告，否则降级并提示补齐；
 * - 缺口保留：UNKNOWN 逐条留在缺口清单里，没写补齐方式的仍保留并提示补；
 * - 演示隔离：演示脚本与本次需求不一致时阻断，示例不冒充真实研究。
 * - 多来源口径：多份来源并存、正文又下确定性结论时，必须写明口径差异或待验证项。
 *
 * 判定只看报告自身、不调用模型；状态与内容版本一起返回，内容改了旧判定自然失效。
 */

import { validateNewProductConclusion } from "./report-contract";
import { goalConstraintPhrases, type MissionReport } from "./report-format";

import { REPORT_QUALITY_SCHEMA_VERSION, type StoredReportQuality } from "@/shared/report-quality-store";

export const REPORT_QUALITY_VERSION = REPORT_QUALITY_SCHEMA_VERSION;

export type ReportQualityStatus = StoredReportQuality["status"];

export interface ReportQualityIssue {
  /** 稳定规则 id，供测试与诊断引用。 */
  rule: string;
  /** block 停止正式交付；draft 只降级为待补证草稿。 */
  level: "block" | "draft";
  /** 出问题的位置（分节 / 字段），写给用户看。 */
  where: string;
  detail: string;
  fix: string;
}

export interface ReportQuality {
  status: ReportQualityStatus;
  issues: ReportQualityIssue[];
  /** 内容指纹：内容变了，旧判定就不再适用。 */
  version: string;
}

/** 状态展示文案：界面与导出共用一张表，避免各处自己拼词。 */
export const REPORT_QUALITY_LABEL: Record<ReportQualityStatus, string> = {
  DELIVERABLE: "可交付",
  DRAFT_UNVERIFIED: "待补证草稿",
  BLOCKED: "未通过质量检查",
};

/** djb2 指纹，纯函数、无 node 依赖，客户端也能算。 */
export function reportContentVersion(report: MissionReport): string {
  const text = [report.title, report.goal, report.conclusion ?? "", ...report.steps.map((step) => step.output ?? ""), JSON.stringify(report.content ?? null), report.contentStatus ?? "MISSING"].join("\n");
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

/** 约束有没有落进报告：数字或连续二字片段命中即算覆盖（宽松，只用于降级提示）。 */
function constraintMissing(text: string, body: string): boolean {
  const digits = text.match(/\d+/g) ?? [];
  if (digits.some((digit) => body.includes(digit))) return false;
  const grams = new Set<string>();
  for (let i = 0; i + 2 <= text.length; i++) grams.add(text.slice(i, i + 2));
  for (const gram of grams) if (body.includes(gram)) return false;
  return grams.size > 0;
}

/**
 * 数字口径（需求 §4.5）：金额、比例、样本与效果数字必须写明来源、单位或适用范围，
 * 并标注（事实）/（推断）；缺依据的数字只能当假设/待验证，不能写成既定事实。
 */
const NUMBER_CLAIM = /\d[\d.,]*\s*(?:%|％|万|亿|元|块|kg|g|mg|天|个月|月|年|周|小时|倍|人|条|家|款|件|次|吨|ml|L)/g;
/** 同一行出现这些标记，视为该数字已交代来源或口径。 */
const CLAIM_MARK = /（事实）|（推断）|（UNKNOWN|来源\s*[:：]|参考\s*[:：]|引自|据.{0,6}显示/;
/**
 * 这些行不算「数字缺依据」：缺口条目（UNKNOWN／待验证／需要补齐）、需求里自带的
 * 用户约束与假设。施工需求 §2 明确预算是开发约束而非市场证据，引用预算不应判无依据。
 */
const NUMBER_EXEMPT = /UNKNOWN|待验证|待补|尚未|未知|需要|预算|假设|预估|上限|以内/;

function numberIssues(body: string): ReportQualityIssue[] {
  const bad: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const hits = line.match(NUMBER_CLAIM) ?? [];
    if (hits.length > 0 && !CLAIM_MARK.test(line) && !NUMBER_EXEMPT.test(line)) bad.push(line.slice(0, 48));
  }
  if (bad.length === 0) return [];
  return [
    {
      rule: "R-NUMBER",
      level: "draft",
      where: "数字依据",
      detail: `有 ${bad.length} 处数字（金额/比例/样本/效果）没写来源、统计范围或事实与推断标注，例如：「${bad[0]}」。`,
      fix: "给每个关键数字补上来源、统计范围与时间，并标注（事实）或（推断）；没有依据的按待验证处理，不要写成事实。",
    },
  ];
}

/**
 * 依据检查（需求 §4.4）：来源引用要真的存在；用户输入与演示数据不能抬高证据等级。
 * 只做确定性判定——来源条数为 0 却声称已核实/已验证，一律降级并说明。
 */
function evidenceIssues(report: MissionReport, body: string): ReportQualityIssue[] {
  const sources = report.researchSources?.length ?? 0;
  const claimsVerified = /已核实|已验证|经过验证|证据显示|研究表明|数据显示/.test(body);
  if (sources === 0 && claimsVerified) {
    return [
      {
        rule: "R-EVIDENCE",
        level: "draft",
        where: "依据",
        detail: "正文声称已核实/已有数据支撑，但本次任务没有留下任何研究来源记录。",
        fix: "补上来源记录，或把这类表述改成「待验证」；来源存在不等于事实已被独立核验，未核验要如实标注。",
      },
    ];
  }
  if (report.demo && sources > 0) {
    return [
      {
        rule: "R-EVIDENCE",
        level: "block",
        where: "依据",
        detail: "演示运行里出现的来源不能算作本次需求的真实研究来源。",
        fix: "演示只用于流程演练；本需求需要真实运行，来源才计入证据。",
      },
    ];
  }
  return [];
}

/**
 * 措辞检查（需求 §4.6）：证据不足时不能用兜底话术变成「已核实」「零风险」。
 * 零风险需要真实检查依据，否则必须显示「尚未完成风险评估」。
 */
const OVERCLAIM = /零风险|无风险|没有风险|可直接上市|直接上市|可直接用于客户沟通|已核实|全部验证|完全可靠/g;

function wordingIssues(report: MissionReport, body: string): ReportQualityIssue[] {
  const hits = Array.from(new Set(body.match(OVERCLAIM) ?? []));
  const sources = report.researchSources?.length ?? 0;
  if (hits.length === 0) return [];
  if (sources === 0 || report.demo) {
    return [
      {
        rule: "R-WORDING",
        level: "draft",
        where: "措辞",
        detail: `正文出现了「${hits.join("、")}」这类确定性结论，但本次没有可用的来源支撑。`,
        fix: "把确定性表述改成条件式结论；没有完成风险评估时写「尚未完成风险评估」，不要写零风险。",
      },
    ];
  }
  return [];
}

/**
 * 多来源口径（需求 §5「多来源重复/矛盾/不相关材料」）。
 * 确定性规则判断不了两份材料谁对，但能判断：正文引用了多份来源、又下了确定性结论，
 * 却一个字没提口径差异或待验证项。这种情况不能冒充已核实——把差异写进缺口清单即可通过。
 */
const CONFLICT_CLAIM = /已核实|已验证|经过验证|证据显示|研究表明|数据显示|结论确定|可以确认/;
/**
 * 已如实交代限制：待验证 / 矛盾 / 口径差异 / 推断标注 / 缺口条目。
 * 不含「需要」——八节契约本身要求「需要你决定」字样，放进来会让这条规则形同虚设。
 */
const CONFLICT_ACK = /待验证|矛盾|不一致|口径|（推断）|UNKNOWN|尚待|未能确认/;

function conflictIssues(report: MissionReport, body: string): ReportQualityIssue[] {
  const sources = report.researchSources?.length ?? 0;
  if (sources < 2) return [];
  if (!CONFLICT_CLAIM.test(body)) return [];
  if (CONFLICT_ACK.test(body)) return [];
  return [
    {
      rule: "R-CONFLICT",
      level: "draft",
      where: "多来源口径",
      detail: `正文引用了 ${sources} 份来源并给出确定性结论，但没有说明这些来源之间是否存在口径差异或待验证项。`,
      fix: "多份来源并存时，把冲突的数字与口径写进缺口清单（UNKNOWN：…（需要 …）），或把确定性表述改成条件式结论。",
    },
  ];
}

export function assessMissionReportQuality(report: MissionReport): ReportQuality {
  const issues: ReportQualityIssue[] = [];
  const conclusion = (report.conclusion ?? "").trim();
  const body = [conclusion, ...report.steps.map((step) => step.output ?? "")].join("\n");

  if (!conclusion) {
    issues.push({
      rule: "R-CONTENT",
      level: "block",
      where: "结论",
      detail: "这份任务还没有形成综合结论，不能作为正式研究报告交付。",
      fix: "先完成任务、形成结论，再打开报告。",
    });
  }

  // Semantics are reviewed by the Agent after durable template projection, never suffix regexes.
  if (report.content?.review?.topicMatch === false || report.contentStatus === "REJECTED") {
    issues.push({ rule: "R-TOPIC", level: "block", where: "研究对象",
      detail: report.content?.review?.note || "Agent 审校发现需求与报告对象不匹配。", fix: "按需求重新研究，不能通过标题改写包装错配内容。" });
  }
  if (report.contentStatus !== "READY" || report.content?.status !== "READY" || report.content.review?.topicMatch !== true) {
    issues.push({ rule: "R-PRESENTATION", level: "draft", where: "内容审校",
      detail: "结构化内容尚未完成落库、模板读回与 Agent 审校；不能当作成品卡片。", fix: "运行内容提炼与有界审校；历史报告需重新运行，GET 不调用模型。" });
  }

  if (report.demo && issues.some((issue) => issue.rule === "R-TOPIC")) {
    issues.push({
      rule: "R-DEMO",
      level: "block",
      where: "演示",
      detail: "演示脚本的内容与本次需求不一致。",
      fix: "演示只用于流程演练；本次需求需要真实运行才能得到结论。",
    });
  }

  for (const problem of validateNewProductConclusion(conclusion).problems) {
    issues.push({
      rule: "R-CONTRACT",
      level: "draft",
      where: "报告结构",
      detail: problem,
      fix: "补齐该分节或按契约标注后重新生成。",
    });
  }

  for (const constraint of goalConstraintPhrases(report.goal)) {
    if (body && constraintMissing(constraint.text, body)) {
      issues.push({
        rule: "R-CONSTRAINT",
        level: "draft",
        where: `需求约束 · ${constraint.kind}`,
        detail: `需求写明了${constraint.kind}「${constraint.text}」，报告里没有对应分析。`,
        fix: `在报告里补上对${constraint.kind}的分析，或说明为什么无法覆盖。`,
      });
    }
  }

  issues.push(...numberIssues(body));
  issues.push(...evidenceIssues(report, body));
  issues.push(...wordingIssues(report, body));
  issues.push(...conflictIssues(report, body));

  const unknownLines = body.split(/\r?\n/).filter((line) => /UNKNOWN\s*[：:]/i.test(line));
  if (unknownLines.some((line) => !/需要/.test(line))) {
    issues.push({
      rule: "R-UNKNOWN",
      level: "draft",
      where: "缺口清单",
      detail: "有缺口条目没有写补齐方式。",
      fix: "每条缺口补上「（需要 <如何补齐>）」，让人知道下一步怎么补。",
    });
  }

  const status: ReportQualityStatus = issues.some((issue) => issue.level === "block")
    ? "BLOCKED"
    : issues.length
      ? "DRAFT_UNVERIFIED"
      : "DELIVERABLE";

  return { status, issues, version: reportContentVersion(report) };
}
