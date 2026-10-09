/**
 * Kern Rich Reply & HTML Artifact protocol (kern-rich/v1)
 * ======================================================
 * Pure module — shared by the conversation engine (server) and the /muse renderer (client).
 *
 * Two layers, one message:
 *   1. Rich blocks — ```kern-ui fenced JSON inside the normal Markdown reply. Rendered by
 *      controlled React components (no HTML from the model ever reaches the app DOM).
 *   2. HTML artifacts — <kern-artifact key=".." title=".." kind="..">…</kern-artifact>.
 *      The engine extracts them before Markdown normalisation, persists a versioned
 *      KernArtifact row and leaves a marker line `[[kern-artifact:<id>@<version>]]`
 *      where the tag was. The client previews them in a sandboxed iframe only.
 *
 * Spec: docs/KERN_RICH_REPLY.md
 */

export const KERN_RICH_VERSION = "kern-rich/v1";
export const ARTIFACT_MAX_HTML = 300_000;
export const ARTIFACT_KINDS = ["compare", "cost", "plan", "report", "dashboard", "other"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export const ARTIFACT_KIND_LABEL: Record<ArtifactKind, string> = {
  compare: "方案比较", cost: "成本分析", plan: "项目计划", report: "分析报告", dashboard: "看板", other: "可视化",
};

/** Told to the model (persona). Kept short: the renderer, not the model, owns layout. */
export const KERN_RICH_PROMPT = [
  `富回复与可视化成果（${KERN_RICH_VERSION}）：`,
  "A. 默认写 Markdown。只有结构真的帮助理解时，才插入结构化块：一个 ```kern-ui 代码块里放一个 JSON 对象。简短答疑不要用结构化块。",
  "   可用 type：",
  '   - metrics：{"type":"metrics","title":"..","items":[{"label":"..","value":"¥12.4","note":"..","basis":"fact|inference|assumption|unknown","source":1}]}',
  '   - compare：{"type":"compare","title":"..","options":[{"name":"方案A","tagline":"..","pick":true,"pros":[".."],"cons":[".."]}],"criteria":[{"label":"成本","values":["低","高"]}]}',
  '   - chart：{"type":"chart","chart":"bar|waterfall|donut","title":"..","unit":"元","series":[{"label":"原料","value":8.05}],"basis":"fact|inference|assumption","source":"数值出处（必填）"}',
  '   - timeline：{"type":"timeline","title":"..","items":[{"when":"第1-2周","phase":"..","deliverable":"..","status":"done|active|todo|blocked","depends":["阶段名"]}]}',
  '   - flow：{"type":"flow","title":"..","nodes":[{"id":"a","label":"..","detail":".."}],"edges":[["a","b"]]}（因果、结构或步骤关系）',
  '   - risks：{"type":"risks","title":"..","items":[{"risk":"..","impact":"high|medium|low","mitigation":"..","basis":"fact|inference|assumption|unknown"}]}',
  '   - table / callout / unknown / decision / keypoints：与报告信封同结构（table: cols+rows；callout: tone+title+body；unknown: items[{question,needs}]；decision: headline+confidence+recommend+against+risks）。',
  '   - sources：{"type":"sources","items":[{"n":1,"title":"..","url":"https://..","trust":"user|internal|external|model"}]}；正文用 [1] 角标引用。',
  '   - next：{"type":"next","items":[{"label":"做成对比视图","prompt":"把上面的分析做成可交互的对比视图"}]}（最多 3 个）',
  "B. 数字必须有出处：chart 必填 source；没有可靠数值时用 compare / flow / unknown 说明缺口，绝不为了好看补造数字、百分比或进度。用户给的数字标 basis=fact 并注明“用户提供”；估算标 inference 或 assumption。",
  "C. 当用户要求可视化、仪表盘、交互图表、对比视图，或内容确实适合独立阅读（方案比较、成本情景、项目计划）时，输出一个完整 HTML 成果：",
  '   <kern-artifact key="英文短横线标识" title="成果标题" kind="compare|cost|plan|report|dashboard|other">',
  "   <!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><style>…</style></head><body>…<script>…</script></body></html>",
  "   </kern-artifact>",
  "   - 先在标签外用 1–3 句话写结论，HTML 只是可视化载体；整条回复最多一个成果。",
  "   - 全部样式、数据、SVG 与脚本内联；不得引用任何外部网址、字体、图片或接口（运行环境断网且无同源权限）。",
  "   - 可用轻量 JavaScript 做标签切换、情景选择、折叠详情；同时适配 390px 手机、浅色与深色（prefers-color-scheme）。",
  "   - 在 HTML 中同样区分事实、推断、假设与未知，并列出数值来源。",
  "   - 需要用户继续操作时可调用 window.kern && window.kern.ask('给 Kern 的一句话')，它只会把文字放进输入框，由用户决定是否发送。",
  "D. 修改已有成果（如“突出风险”“换成对比视图”“修改第二个方案”）时，沿用同一个 key，输出修改后的完整 HTML，系统会保存为新版本。",
].join("\n");

// ───────── artifact extraction ─────────

export type ExtractedArtifact = {
  /** Stable key chosen by the model (or derived from the title). */
  key: string;
  title: string;
  kind: ArtifactKind;
  html: string;
  complete: boolean;
  error: string | null;
};

const OPEN_RE = /<kern-artifact\b([^>]*)>/i;
const CLOSE_RE = /<\/kern-artifact\s*>/i;
const ATTR_RE = /([a-zA-Z_-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

export function artifactMarker(key: string): string {
  return `[[kern-artifact:${key}]]`;
}
/** Marker in persisted content: `[[kern-artifact:<id>@<version>]]` (id is a uuid). */
export const PERSISTED_MARKER_RE = /^\s*\[\[kern-artifact:([A-Za-z0-9-]{8,64})@(\d{1,4})\]\]\s*$/;
export const ANY_MARKER_RE = /\[\[kern-artifact:([A-Za-z0-9_-]{1,64})(?:@(\d{1,4}))?\]\]/g;

function attrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(ATTR_RE)) out[m[1].toLowerCase()] = (m[3] ?? m[4] ?? "").trim();
  return out;
}

export function normalizeArtifactKey(raw: string | undefined, title: string, index: number): string {
  const slug = (raw ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  if (slug.length >= 2) return slug;
  let h = 0;
  for (const ch of title || `artifact-${index}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `artifact-${h.toString(36)}`;
}

function cleanTitle(raw: string | undefined): string {
  const t = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return t || "可视化成果";
}

function kindOf(raw: string | undefined): ArtifactKind {
  return (ARTIFACT_KINDS as readonly string[]).includes(raw ?? "") ? (raw as ArtifactKind) : "other";
}

/** Strip an optional ```html fence the model may wrap around the document. */
function unwrapFence(html: string): string {
  const t = html.trim();
  const m = /^```[\w-]*\n([\s\S]*?)\n?```$/.exec(t);
  return m ? m[1].trim() : t;
}

export function checkArtifactHtml(html: string): string | null {
  if (!html.trim()) return "成果内容为空";
  if (html.length > ARTIFACT_MAX_HTML) return `成果超过 ${Math.round(ARTIFACT_MAX_HTML / 1000)}K 字符上限`;
  const hasHtmlOpen = /<html[\s>]/i.test(html);
  if (hasHtmlOpen && !/<\/html\s*>/i.test(html)) return "HTML 文档没有完整返回（缺少 </html>）";
  const scripts = (html.match(/<script\b/gi) ?? []).length;
  const scriptCloses = (html.match(/<\/script\s*>/gi) ?? []).length;
  if (scripts !== scriptCloses) return "HTML 中的脚本没有完整返回";
  return null;
}

/**
 * Pull every <kern-artifact> out of a raw model reply. Text outside the tags is kept;
 * each tag is replaced with a marker line so the card renders in place.
 * An unterminated tag (truncated generation) yields a failed artifact — the prose
 * written before it is preserved.
 */
export function extractArtifacts(raw: string): { text: string; artifacts: ExtractedArtifact[] } {
  let rest = (raw ?? "").replace(/\r\n?/g, "\n");
  const artifacts: ExtractedArtifact[] = [];
  let out = "";
  for (let guard = 0; guard < 6; guard++) {
    const open = OPEN_RE.exec(rest);
    if (!open) break;
    const a = attrs(open[1]);
    const title = cleanTitle(a.title);
    const key = normalizeArtifactKey(a.key ?? a.id, title, artifacts.length);
    out += rest.slice(0, open.index);
    const after = rest.slice(open.index + open[0].length);
    const close = CLOSE_RE.exec(after);
    const body = unwrapFence(close ? after.slice(0, close.index) : after);
    const error = close ? checkArtifactHtml(body) : "生成中断：成果 HTML 没有完整返回";
    // A later tag with the same key in one reply supersedes the earlier one.
    const existing = artifacts.findIndex((x) => x.key === key);
    const item: ExtractedArtifact = { key, title, kind: kindOf(a.kind ?? a.type), html: body, complete: !error, error };
    if (existing >= 0) artifacts[existing] = item; else artifacts.push(item);
    out += `\n\n${artifactMarker(key)}\n\n`;
    rest = close ? after.slice(close.index + close[0].length) : "";
  }
  out += rest;
  return { text: out.replace(/\n{3,}/g, "\n\n").trim(), artifacts };
}

// ───────── sandbox document ─────────

export const ARTIFACT_CHANNEL = "kern-artifact/v1";

/** Network-less CSP for every rendered/exported artifact. */
export const ARTIFACT_CSP =
  "default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";

function injectHead(html: string, head: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${head}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${head}</head><body>${html}</body></html>`;
}

function bridgeScript(mode: "host" | "standalone", artifactId: string, nonce: string): string {
  const id = JSON.stringify(artifactId);
  const n = JSON.stringify(nonce);
  const ch = JSON.stringify(ARTIFACT_CHANNEL);
  if (mode === "standalone") {
    return `<script>window.kern={ask:function(t){try{var d=document.createElement('div');d.textContent='离线副本：请回到 Kern 继续修改（'+String(t).slice(0,80)+'）';d.style.cssText='position:fixed;left:50%;bottom:16px;transform:translateX(-50%);padding:10px 14px;border-radius:10px;background:#201831;color:#fff;font:13px system-ui;z-index:2147483647';document.body.appendChild(d);setTimeout(function(){d.remove()},2600)}catch(e){}}};</script>`;
  }
  return `<script>(function(){var id=${id},n=${n},ch=${ch};function post(type,extra){var m={channel:ch,artifactId:id,nonce:n,type:type};for(var k in extra)m[k]=extra[k];parent.postMessage(m,'*')}window.kern={ask:function(t){post('ask',{text:String(t||'').slice(0,500)})}};function size(){post('height',{height:Math.ceil(document.documentElement.scrollHeight)})}addEventListener('load',function(){post('ready',{});size()});try{new ResizeObserver(size).observe(document.documentElement)}catch(e){}})();</script>`;
}

/** Document for the sandboxed iframe (srcdoc). Never rendered without sandbox="allow-scripts". */
export function buildSandboxDocument(html: string, opts: { artifactId: string; nonce: string; theme?: "light" | "dark" }): string {
  const head = [
    `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`,
    `<meta name="referrer" content="no-referrer">`,
    opts.theme ? `<meta name="color-scheme" content="${opts.theme}">` : "",
    bridgeScript("host", opts.artifactId, opts.nonce),
  ].join("");
  return injectHead(html, head);
}

/** Offline, self-contained export. Same CSP, a provenance comment, and a no-network bridge. */
export function buildStandaloneDocument(html: string, meta: { artifactId: string; title: string; version: number; createdAt: string }): string {
  const esc = (s: string) => s.replace(/--/g, "—").replace(/[<>]/g, "");
  const head = [
    `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`,
    `<meta name="generator" content="Kern ${KERN_RICH_VERSION}">`,
    `<meta name="kern-artifact" content="${esc(meta.artifactId)}@v${meta.version}">`,
    bridgeScript("standalone", meta.artifactId, ""),
  ].join("");
  const doc = injectHead(html, head);
  const comment = `<!-- Kern 成果「${esc(meta.title)}」 v${meta.version} · ${esc(meta.createdAt)} · 离线副本，样式、数据与交互均已内联 -->\n`;
  return /^\s*<!doctype/i.test(doc) ? doc.replace(/^\s*(<!doctype[^>]*>)/i, `$1\n${comment}`) : comment + doc;
}

export function artifactFileName(title: string, version: number): string {
  const base = title.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "kern-artifact";
  return `${base}-v${version}.html`;
}

/** Validate a postMessage coming from an artifact frame. */
export function readArtifactMessage(data: unknown, expected: { artifactId: string; nonce: string }):
  | { type: "ready" }
  | { type: "height"; height: number }
  | { type: "ask"; text: string }
  | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const m = data as Record<string, unknown>;
  if (m.channel !== ARTIFACT_CHANNEL || m.artifactId !== expected.artifactId || m.nonce !== expected.nonce) return null;
  if (m.type === "ready") return { type: "ready" };
  if (m.type === "height" && typeof m.height === "number" && Number.isFinite(m.height)) return { type: "height", height: Math.max(0, Math.min(20000, m.height)) };
  if (m.type === "ask" && typeof m.text === "string" && m.text.trim()) return { type: "ask", text: m.text.trim().slice(0, 500) };
  return null;
}

// ───────── citations (message ↔ artifact) ─────────

export type ArtifactCitation = {
  kind: "kern-artifact";
  ref: string;
  key: string;
  version: number;
  title: string;
  artifactKind: ArtifactKind;
  status: "READY" | "FAILED";
  error?: string | null;
};

export function readArtifactCitation(raw: unknown): ArtifactCitation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  if (c.kind !== "kern-artifact" || typeof c.ref !== "string" || typeof c.version !== "number") return null;
  return {
    kind: "kern-artifact",
    ref: c.ref,
    key: typeof c.key === "string" ? c.key : c.ref,
    version: c.version,
    title: typeof c.title === "string" ? c.title : "可视化成果",
    artifactKind: kindOf(typeof c.artifactKind === "string" ? c.artifactKind : undefined),
    status: c.status === "FAILED" ? "FAILED" : "READY",
    error: typeof c.error === "string" ? c.error : null,
  };
}

export function artifactCitations(citations: unknown[]): ArtifactCitation[] {
  return citations.map(readArtifactCitation).filter((c): c is ArtifactCitation => c !== null);
}

export function isArtifactCitation(raw: unknown): boolean {
  return !!raw && typeof raw === "object" && !Array.isArray(raw) && (raw as Record<string, unknown>).kind === "kern-artifact";
}

/** Replace persisted markers with a readable placeholder (model history, copy, export). */
export function describeMarkers(text: string, artifacts: ArtifactCitation[]): string {
  return text.replace(ANY_MARKER_RE, (_m, id: string, v?: string) => {
    const a = artifacts.find((x) => x.ref === id || x.key === id);
    if (!a) return "〔可视化成果〕";
    return a.status === "FAILED"
      ? `〔可视化成果「${a.title}」生成失败（key=${a.key}）〕`
      : `〔可视化成果「${a.title}」key=${a.key} v${v ?? a.version}〕`;
  });
}
