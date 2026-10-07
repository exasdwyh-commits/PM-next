/**
 * KX-34 · 5 段 cron（分 时 日 月 周），按指定时区计算下一次触发时间。纯函数。
 * 支持 *、列表 a,b、范围 a-b、步长 *\/n 与 a-b/n；周 0 或 7 都是周日。
 * 日与周同时受限时按 cron 惯例取「或」。
 */

export type CronFields = { minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number>; domAny: boolean; dowAny: boolean };

const RANGES: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

function parseField(src: string, [lo, hi]: [number, number]): Set<number> {
  const out = new Set<number>();
  for (const part of src.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim());
    if (!m) throw new Error(`无法识别：${part}`);
    let a = lo;
    let b = hi;
    if (m[1] !== "*") {
      const [x, y] = m[1].split("-").map(Number);
      a = x;
      b = y ?? (m[2] ? hi : x);
    }
    const step = m[2] ? Number(m[2]) : 1;
    if (a < lo || b > hi || a > b || step < 1) throw new Error(`超出范围：${part}（${lo}-${hi}）`);
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("cron 需要 5 段：分 时 日 月 周");
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, RANGES[i]));
  if (dow.has(7)) dow.add(0);
  return { minute, hour, dom, month, dow, domAny: parts[2] === "*", dowAny: parts[4] === "*" };
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsIn(date: Date, tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
    fmtCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { month: Number(p.month), day: Number(p.day), hour: Number(p.hour) % 24, minute: Number(p.minute), dow };
}

/** 严格晚于 from 的下一次触发时间（最多向后找 400 天，找不到返回 null，例如 2 月 30 日）。 */
export function nextCronRun(expr: string | CronFields, from: Date, tz = "Asia/Shanghai"): Date | null {
  const c = typeof expr === "string" ? parseCron(expr) : expr;
  let t = Math.floor(from.getTime() / 60_000) * 60_000 + 60_000;
  const limit = from.getTime() + 400 * 86_400_000;
  while (t <= limit) {
    const d = new Date(t);
    const p = partsIn(d, tz);
    const dayOk = c.domAny && c.dowAny ? true : c.domAny ? c.dow.has(p.dow) : c.dowAny ? c.dom.has(p.day) : c.dom.has(p.day) || c.dow.has(p.dow);
    if (!c.month.has(p.month) || !dayOk) {
      t += ((23 - p.hour) * 60 + (60 - p.minute)) * 60_000; // 跳到当地次日 00:00
      continue;
    }
    if (!c.hour.has(p.hour)) {
      t += (60 - p.minute) * 60_000; // 跳到下一个整点
      continue;
    }
    if (!c.minute.has(p.minute)) {
      t += 60_000;
      continue;
    }
    return d;
  }
  return null;
}

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const pad = (n: number) => String(n).padStart(2, "0");

/** 常见表达式的中文描述；其余原样返回。 */
export function describeCron(expr: string): string {
  const m = /^(\d+) (\d+) \* \* (\*|[\d,\-]+)$/.exec(expr.trim());
  if (m) {
    const time = `${pad(Number(m[2]))}:${pad(Number(m[1]))}`;
    if (m[3] === "*") return `每天 ${time}`;
    if (m[3] === "1-5") return `工作日 ${time}`;
    try {
      const days = [...parseField(m[3], [0, 7])].map((d) => WEEK[d % 7]);
      return `每${[...new Set(days)].join("、")} ${time}`;
    } catch {
      return expr;
    }
  }
  const h = /^(\d+) \*\/(\d+) \* \* \*$/.exec(expr.trim());
  if (h) return `每 ${h[2]} 小时（第 ${h[1]} 分）`;
  const d = /^(\d+) (\d+) (\d+) \* \*$/.exec(expr.trim());
  if (d) return `每月 ${d[3]} 日 ${pad(Number(d[2]))}:${pad(Number(d[1]))}`;
  return expr;
}
