/**
* 历史装配：「近期原文 + 远期滚动摘要」。
*
* 替换旧行为：historyRows 全量进内存、再由各调用方做"环形截断+省略声明"
* （旧方式丢信息且不告知丢了什么）。新行为：
* - 最近 N 轮（KERN_HISTORY_KEEP_RECENT_TURNS，默认 10）原文保留；
* - 更早的轮次走滚动摘要：摘要文本本身受 KERN_SUMMARY_MAX_CHARS（默认 2000 字符）
* 硬上限约束，防止摘要膨胀成新的 token 坑；
* - 关键约束（见 constraints.ts 的识别策略）在摘要区原文保留，不依赖模型复述。
*
* 滚动摘要的持久化说明（不改 prisma schema 的取舍）：
* 摘要状态放在进程内 RollingSummaryCache（key=会话/任务 id），记录"已覆盖到第几轮"。
* 命中时只对新增的远期轮次做增量摘要并承接上一版摘要；未命中（冷启动/多实例）
* 则全量重做一次——正确性不受影响，只是多花一次便宜模型的钱。
* 辅助模型位缺配置或调用失败时，摘要整体禁用，调用方回退到"近期原文+省略声明"
* 的旧行为（走原文，而非崩溃）。
*/
import {
callAuxModel,
resolveAuxModelSlot,
type AuxModelSlot,
} from "../model-gateway/aux-slots";
import { extractKeyConstraints} from "./constraints";

export interface HistoryTurn {
role: string;
content: string;
}

export interface SplitHistory {
/** 近期轮次（原文保留） */
recent: HistoryTurn[];
/** 远期轮次（进摘要） */
older: HistoryTurn[];
}

export function splitHistory(turns: HistoryTurn[], keepRecentTurns: number): SplitHistory {
const keep = Math.max(0, Math.floor(keepRecentTurns));
if (keep === 0) return { recent: [], older: [...turns]};
return { recent: turns.slice(-keep), older: turns.slice(0, Math.max(0, turns.length - keep))};
}

/** 在句界截断，句界只在后 40% 区间内有效，否则硬截。 */
export function truncateAtSentence(text: string, maxChars: number): string {
if (text.length <= maxChars) return text;
const slice = text.slice(0, maxChars);
let cut = -1;
for (const m of ["。", "！", "？", "!", "?", "\n", "；", ";"]) {
const i = slice.lastIndexOf(m);
if (i > cut) cut = i;
}
if (cut > maxChars * 0.6) return slice.slice(0, cut + 1);
return slice + "…";
}

export interface SummaryBlockInput {
/** 模型生成的滚动摘要正文（可为空字符串，此时只剩约束区） */
summaryText: string;
/** 原文保留的关键约束 */
constraints: string[];
/** 整个摘要块的字符上限（含约束区） */
maxChars: number;
}

/**
* 渲染进 prompt 的摘要块。约束区优先保：先保证约束区完整，再把剩余预算给摘要正文；
* 约束区本身超限时，按原文出现顺序保留能放下的（早立的长期规则优先）。
*/
export function renderSummaryBlock(input: SummaryBlockInput): string {
const maxChars = Math.max(200, Math.floor(input.maxChars));
const header = "## 历史滚动摘要\n（以下为较早轮次的压缩摘要，可能遗漏细节；关键约束见下，以约束区原文为准）\n";
const constraintHeader = "\n## 关键约束（原文保留，优先级高于摘要）\n";

const fittingConstraints: string[] = [];
let used = header.length + constraintHeader.length;
for (const c of input.constraints) {
const line = `- ${c}\n`;
if (used + line.length > maxChars) break;
fittingConstraints.push(line);
used += line.length;
}
const constraintSection = fittingConstraints.length
? constraintHeader + fittingConstraints.join("")
: "";
const summaryBudget = Math.max(0, maxChars - header.length - constraintSection.length);
const summaryText = truncateAtSentence(input.summaryText.trim(), summaryBudget);
return (header + summaryText + constraintSection).trimEnd();
}

export interface RollingSummaryEntry {
/** 摘要已覆盖到的远期轮次数（older.length 的快照） */
coveredTurns: number;
summary: string;
updatedAt: number;
}

/** 进程内滚动摘要缓存。见文件头注释的持久化取舍说明。 */
export class RollingSummaryCache {
private store = new Map<string, RollingSummaryEntry>();
constructor(
private ttlMs = 30 * 60_000,
private maxEntries = 500
) {}

get(key: string): RollingSummaryEntry | null {
const e = this.store.get(key);
if (!e) return null;
if (Date.now() - e.updatedAt > this.ttlMs) {
this.store.delete(key);
return null;
}
return e;
}

put(key: string, coveredTurns: number, summary: string): void {
if (this.store.size >= this.maxEntries) {
const oldest = [...this.store.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0];
if (oldest) this.store.delete(oldest[0]);
}
this.store.set(key, { coveredTurns, summary, updatedAt: Date.now()});
}

clear(): void {
this.store.clear();
}
}

/** 供接线使用的进程级单例；单测请自建实例注入。 */
export const rollingSummaryCache = new RollingSummaryCache();

export interface SummarizeSegmentInput {
slot: AuxModelSlot;
/** 上一版滚动摘要（增量承接用，可空） */
prevSummary: string | null;
/** 本次新增的远期轮次文本 */
segmentText: string;
/** 摘要正文的目标上限（字符） */
maxChars: number;
signal?: AbortSignal;
/** C7：统一网关记账要求组织 id；调用方（对话/Mission）透传 */
organizationId?: string | null;
}

/**
* 调辅助模型位做一段摘要。prompt 里不埋任何控制标记/魔法词，
* 只给压缩任务说明；失败时抛错，由 assembleCompressedHistory 捕获后降级。
*/
export async function summarizeOlderSegment(input: SummarizeSegmentInput): Promise<string> {
const target = Math.max(200, Math.floor(input.maxChars));
const system =
"你是对话历史压缩器。把给定的较早对话轮次压缩成一段中文摘要，" +
`不超过${target}字。保留：讨论的主题、已达成的结论或决策、待办事项、出现的数字与专有名词。` +
"不要编造原文没有的内容。如果给了上一版摘要，先承接它，再把新增轮次的信息增量并入。直接输出摘要正文，不要加前后缀。";
const user = input.prevSummary
? `\n${input.prevSummary}\n\n\n${input.segmentText}`
: `\n${input.segmentText}`;
const text = await callAuxModel(input.slot, {
system,
user,
...(input.signal? { signal: input.signal}: {}),
// C7：经统一网关记账（aux 档位，配额豁免）
...(input.organizationId? { organizationId: input.organizationId}: {}),
});
return truncateAtSentence(text, target);
}

function renderSegmentText(older: HistoryTurn[]): string {
const roleLabel = (r: string) => (r === "user" || r === "USER"? "用户": r === "assistant" || r === "ASSISTANT"? "助手": r);
return older
.map((t) => `${roleLabel(t.role)}：${t.content}`)
.join("\n")
.slice(0, 60_000); // 单次送摘要模型的输入上限，避免病态长会话打爆
}

export type SummarizeFn = (input: {
prevSummary: string | null;
segmentText: string;
maxChars: number;
signal?: AbortSignal;
/** C7：走真实摘要位时经统一网关记账所需 */
organizationId?: string | null;
}) => Promise<string>;

async function defaultSummarize(input: {
prevSummary: string | null;
segmentText: string;
maxChars: number;
signal?: AbortSignal;
organizationId?: string | null;
}): Promise<string> {
const slot = resolveAuxModelSlot("summary");
if (!slot) throw new Error("摘要辅助模型位未配置");
return summarizeOlderSegment({ slot,...input});
}

export interface AssembleCompressedHistoryInput {
turns: HistoryTurn[];
keepRecentTurns: number;
/** 摘要块总字符上限 */
maxChars: number;
/** 滚动缓存 key（如会话 id）；不传则不做增量缓存，每次全量摘要 */
cacheKey?: string;
cache?: RollingSummaryCache;
/** 可注入（单测用假摘要器）；默认走摘要辅助模型位 */
summarize?: SummarizeFn;
signal?: AbortSignal;
/** C7：真实摘要位经统一网关记账所需的组织 id；不传则摘要调用缺 org 会抛错并降级 */
organizationId?: string | null;
}

export interface AssembledHistory {
recent: HistoryTurn[];
/** 进 prompt 的摘要块；null 表示摘要禁用/无远期内容，调用方走旧行为 */
summaryBlock: string | null;
olderCount: number;
/** 是否真正走了模型摘要（false = 降级/无远期） */
summaryUsed: boolean;
constraints: string[];
}

export async function assembleCompressedHistory(
input: AssembleCompressedHistoryInput
): Promise<AssembledHistory> {
const { recent, older} = splitHistory(input.turns, input.keepRecentTurns);
const constraints = extractKeyConstraints(older);
const cache = input.cache;
const cacheKey = input.cacheKey;

if (older.length === 0) {
return {
recent,
summaryBlock: constraints.length? renderSummaryBlock({ summaryText: "", constraints, maxChars: input.maxChars}): null,
olderCount: 0,
summaryUsed: false,
constraints,
};
}

const summarize = input.summarize?? defaultSummarize;
const prev = cacheKey && cache? cache.get(cacheKey): null;
const incremental = prev && prev.coveredTurns < older.length && prev.coveredTurns >= 0;
const segment = incremental? older.slice(prev!.coveredTurns): older;
const prevSummary = incremental? prev!.summary: null;
const segmentText = renderSegmentText(segment);

let summaryText: string | null = null;
if (segmentText.trim()) {
try {
summaryText = await summarize({
prevSummary,
segmentText,
maxChars: input.maxChars,
...(input.signal? { signal: input.signal}: {}),
...(input.organizationId? { organizationId: input.organizationId}: {}),
});
if (cacheKey && cache && summaryText.trim()) {
cache.put(cacheKey, older.length, summaryText);
}
} catch {
// 摘要位未配置或调用失败 → 降级：摘要不用，但约束区仍保留（不崩溃）
summaryText = null;
}
} else if (prevSummary) {
summaryText = prevSummary;
}

if (summaryText === null && constraints.length === 0) {
return { recent, summaryBlock: null, olderCount: older.length, summaryUsed: false, constraints};
}
return {
recent,
summaryBlock: renderSummaryBlock({
summaryText: summaryText?? "",
constraints,
maxChars: input.maxChars,
}),
olderCount: older.length,
summaryUsed: summaryText!== null,
constraints,
};
}
