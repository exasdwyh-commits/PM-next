/**
 * Response harness
 * ================
 * 机械校验一个 ResponseEnvelope 是否符合 docs/KERN_RESPONSE_SPEC.md §4。
 *
 * 设计取舍：
 * - 纯函数、零依赖、同构（Node 测试与浏览器渲染器共用同一份规则），
 *   避免"CI 通过但界面上仍然出现套话"这种两套真相的问题。
 * - error 级 → 不渲染，回退成"我这次没答好"并重跑；warn 级 → 渲染但在完整层标黄。
 */

import type { Block, ClaimKind, ResponseEnvelope } from "./types";

export type Level = "error" | "warn";

export interface Rule {
  id: string;
  desc: string;
  level: Level;
  /** 返回 true 表示通过；返回字符串表示失败原因。 */
  run: (env: ResponseEnvelope) => true | string;
}

export interface Issue {
  id: string;
  desc: string;
  level: Level;
  detail: string;
}

/** AI 套话黑名单。命中即阻断——Kern 是同事，不是客服机器人。 */
export const BANNED_PHRASES =
  /作为一个\s*AI|作为一名\s*AI|我只是一个|我无法提供|希望[^。！？\n]{0,10}帮助|如有(任何)?疑问，?请随时|总的来说，我建议您/;

const blocksOf = <T extends Block["type"]>(env: ResponseEnvelope, t: T) =>
  env.blocks.filter((b): b is Extract<Block, { type: T }> => b.type === t);

const claims = (env: ResponseEnvelope): { kind: ClaimKind; text: string }[] =>
  blocksOf(env, "keypoints").flatMap((b) => b.items);

export const RULES: Rule[] = [
  {
    id: "R1",
    desc: "lede 存在且 ≤ 60 字",
    level: "error",
    run: (e) =>
      !e.lede ? "lede 缺失" : e.lede.length > 60 ? `lede ${e.lede.length} 字，超长` : true,
  },
  {
    id: "R2",
    desc: "每条要点标注 fact / inference / unknown",
    level: "error",
    run: (e) => {
      const bad = claims(e).filter((i) => !["fact", "inference", "unknown"].includes(i.kind));
      return bad.length === 0 || `${bad.length} 条要点未标注`;
    },
  },
  {
    id: "R3",
    desc: "事实必须带来源角标 [n] 且角标有对应 evidence",
    level: "error",
    run: (e) => {
      const facts = claims(e).filter((c) => c.kind === "fact");
      if (facts.length === 0) return true;
      const ev = blocksOf(e, "evidence").flatMap((b) => b.items);
      if (ev.length === 0) return `有 ${facts.length} 条事实但没有 evidence 块`;
      const naked = facts.filter((f) => !/\[\d+\]/.test(f.text));
      if (naked.length) return `${naked.length} 条事实没有来源角标`;
      const known = new Set(ev.map((x) => x.n));
      const dangling = facts
        .flatMap((f) => [...f.text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))
        .filter((n) => !known.has(n));
      return dangling.length === 0 || `角标 [${[...new Set(dangling)].join("][")}] 没有对应来源`;
    },
  },
  {
    id: "R4",
    desc: "决策卡三段齐全（推荐 / 反对 / 风险）",
    level: "error",
    run: (e) => {
      const ds = blocksOf(e, "decision");
      for (const d of ds) {
        const miss = (["recommend", "against", "risks"] as const).filter((k) => !d[k]?.length);
        if (miss.length) return `决策卡缺 ${miss.join(" / ")}`;
      }
      return true;
    },
  },
  {
    id: "R5",
    desc: "段落 ≤ 280 字",
    level: "warn",
    run: (e) => {
      const long = blocksOf(e, "prose").flatMap((b) => b.body).filter((p) => p.length > 280);
      return long.length === 0 || `${long.length} 段超长`;
    },
  },
  {
    id: "R6",
    desc: "表格 ≤ 6 列，且每行单元格数与列数一致",
    level: "error",
    run: (e) => {
      for (const t of blocksOf(e, "table")) {
        if (t.cols.length > 6) return `表格 ${t.cols.length} 列，超过 6 列`;
        const bad = t.rows.find((r) => r.cells.length !== t.cols.length);
        if (bad) return `有行的单元格数 ${bad.cells.length} ≠ 列数 ${t.cols.length}`;
      }
      return true;
    },
  },
  {
    id: "R7",
    desc: "meta 含 model / elapsedMs / steps",
    level: "error",
    run: (e) => {
      const miss = (["model", "elapsedMs", "steps"] as const).filter((k) => e.meta?.[k] == null);
      return miss.length === 0 || `meta 缺 ${miss.join(" / ")}`;
    },
  },
  {
    id: "R8",
    desc: "demo=true 时不得声明额度消耗",
    level: "error",
    run: (e) => !e.demo || e.meta.quota === null || "演示运行不得占用额度，meta.quota 应为 null",
  },
  {
    id: "R9",
    desc: "正文无 AI 套话",
    level: "error",
    run: (e) => {
      const m = JSON.stringify(e).match(BANNED_PHRASES);
      return !m || `命中「${m[0]}」`;
    },
  },
  {
    id: "R10",
    desc: "出现 unknown 要点时必须说明缺什么源",
    level: "error",
    run: (e) => {
      const unk = claims(e).filter((c) => c.kind === "unknown");
      if (unk.length === 0) return true;
      const ub = blocksOf(e, "unknown");
      if (ub.length === 0) return "有 unknown 要点但缺少 unknown 块";
      const empty = ub.flatMap((b) => b.items).filter((i) => !i.needs?.trim());
      return empty.length === 0 || `${empty.length} 条 unknown 没写 needs`;
    },
  },
  {
    id: "R11",
    desc: "需要人拍板时必须说明「为什么是你」并给出选项",
    level: "error",
    run: (e) => {
      if (!e.ask) return true;
      if (!e.ask.why_you?.trim()) return "ask 缺 why_you";
      return e.ask.options?.length >= 2 || "ask 至少要有 2 个选项";
    },
  },
  {
    id: "R12",
    desc: "正文不含 emoji",
    level: "warn",
    run: (e) => {
      const t = blocksOf(e, "prose").flatMap((b) => b.body).join("");
      return !/\p{Extended_Pictographic}/u.test(t) || "正文出现 emoji";
    },
  },
  {
    id: "R13",
    desc: "CONCLUSION 必须带决策卡，PROGRESS 必须带进度块",
    level: "error",
    run: (e) => {
      if (e.kind === "CONCLUSION" && blocksOf(e, "decision").length === 0)
        return "CONCLUSION 信封缺少 decision 块";
      if (e.kind === "PROGRESS" && blocksOf(e, "progress").length === 0)
        return "PROGRESS 信封缺少 progress 块";
      if (e.kind === "BRIEF" && blocksOf(e, "clarify").length === 0)
        return "BRIEF 信封缺少 clarify 块";
      return true;
    },
  },
  {
    id: "R14",
    desc: "图表必须标单位与来源",
    level: "error",
    run: (e) => {
      for (const c of blocksOf(e, "chart")) {
        if (!c.unit?.trim()) return `图表「${c.label}」缺单位`;
        if (!c.source?.trim()) return `图表「${c.label}」缺来源`;
      }
      return true;
    },
  },
];

export function validate(env: ResponseEnvelope): Issue[] {
  const out: Issue[] = [];
  for (const r of RULES) {
    let res: true | string;
    try {
      res = r.run(env);
    } catch (err) {
      res = `校验异常: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (res !== true) out.push({ id: r.id, desc: r.desc, level: r.level, detail: res });
  }
  return out;
}

/** error 级为空才允许渲染。 */
export function isRenderable(env: ResponseEnvelope): boolean {
  return validate(env).every((i) => i.level !== "error");
}

export function formatIssues(issues: Issue[]): string {
  if (!issues.length) return "全部通过";
  return issues.map((i) => `${i.level === "error" ? "✕" : "!"} ${i.id} ${i.desc} — ${i.detail}`).join("\n");
}
