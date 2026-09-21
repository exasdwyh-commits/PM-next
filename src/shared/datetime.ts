/**
 * 统一时间显示口径（单一事实来源）
 *
 * 为什么必须集中在一个模块里 —— `toLocaleString()` 的两个「默认值」会同时造成两类缺陷：
 *
 *  1) **hydration 失败（页面级）**：不传 locale 时，Node 用服务端默认 locale（本项目实测为 en-US，
 *     输出 `8:45:18 AM`），浏览器用用户 locale（zh-CN，输出 `08:45:18`）。同一棵树的 SSR 与 CSR
 *     文本不同，React 判定 hydration 失败并**在客户端重建整棵子树**。`/projects/[id]` 曾因为
 *     `new Date(pkt.createdAt).toLocaleTimeString()` 触发，页面上还残留 dev overlay 的「1 Issue」。
 *
 *  2) **时区静默偏移（生产才暴露）**：不传 timeZone 时用运行时本地时区。服务端常跑 UTC、
 *     用户浏览器在 Asia/Shanghai → 同一时间戳在两侧差 8 小时，而本地开发（两边同机）看不出来。
 *
 * 另外，散落的 20 余处调用还带出第三个问题：**同一系统内格式不统一**（设置页同一张卡片里
 * `2026-09-16 22:12:15` 与 `2026/9/17 00:25:15` 并存；有的补零有的不补）。
 *
 * 因此这里：显式固定**业务时区** + **不依赖 locale 的数值拼装**，保证任何运行环境（Node/浏览器、
 * 任意机器时区、任意 locale）输出逐字一致。业务需要展示"用户本地时间"时才允许绕过本模块，
 * 且必须显式传 timeZone 并说明理由。
 */

/** 业务基准时区。公司经营与审批留痕统一按北京时间呈现与对账。 */
export const BUSINESS_TIME_ZONE = "Asia/Shanghai";

export type DateInput = Date | string | number | null | undefined;

/** 取不到有效时间时的占位符。调用方可用第二参数覆盖（如「未设置」「从未同步」）。 */
export const DATE_PLACEHOLDER = "—";

/**
 * 用数值字段拼装，而不是直接 format()：
 * `format()` 的输出受 locale 影响（分隔符、年月日顺序、上下午标记），
 * `formatToParts()` 只取数字字段，再自行拼装即可得到 locale 无关的稳定文本。
 * hourCycle 固定 h23，避免某些 ICU 版本把午夜输出成 24 点。
 */
const FIELDS = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fields(d: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of FIELDS.formatToParts(d)) {
    if (part.type !== "literal") out[part.type] = part.value;
  }
  return out;
}

/** `2026-09-16` */
export function fmtDate(value: DateInput, fallback: string = DATE_PLACEHOLDER): string {
  const d = toDate(value);
  if (!d) return fallback;
  const f = fields(d);
  return `${f.year}-${f.month}-${f.day}`;
}

/** `08:45:18` */
export function fmtTime(value: DateInput, fallback: string = DATE_PLACEHOLDER): string {
  const d = toDate(value);
  if (!d) return fallback;
  const f = fields(d);
  return `${f.hour}:${f.minute}:${f.second}`;
}

/** `2026-09-16 08:45`（列表与卡片默认口径） */
export function fmtDateTime(value: DateInput, fallback: string = DATE_PLACEHOLDER): string {
  const d = toDate(value);
  if (!d) return fallback;
  const f = fields(d);
  return `${f.year}-${f.month}-${f.day} ${f.hour}:${f.minute}`;
}

/** `2026-09-16 08:45:18`（留痕/审计等需要精确到秒的场合） */
export function fmtDateTimeFull(value: DateInput, fallback: string = DATE_PLACEHOLDER): string {
  const d = toDate(value);
  if (!d) return fallback;
  const f = fields(d);
  return `${f.year}-${f.month}-${f.day} ${f.hour}:${f.minute}:${f.second}`;
}

/** 判断是否为有效时间，供调用方自行决定占位文案 */
export function isValidDate(value: DateInput): boolean {
  return toDate(value) !== null;
}
