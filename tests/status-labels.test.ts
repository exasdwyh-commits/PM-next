/**
 * 枚举中文化回归锁（无 DB / 无服务依赖）
 *
 * 盯住一类**真实发生过**的缺陷：内部标识（数据库枚举、审计动作名、运行常量、camelCase 字段名）
 * 被直接渲染进中文界面。2026-09-17 全流程可视化走查在界面上实际读到过：
 *   `PENDING` `IN_REVIEW` `TEST_STUB` `FEEDBACK_CREATED` `OBSIDIAN_VAULT`
 *   `targetUserAndNeed` `channelFit` `unknown`
 * 后果不是"不好看"，而是让业务使用者以为系统没做完、不敢采信。
 *
 * 设计取舍：
 *  - 不只锁"这几个映射值对不对"（那只能防住已知的八处），而是**锁住泄漏的形态本身**
 *    （守卫 4/5）——否则下次新增一个 `<Badge status={x} />` 就再次泄漏，测试照样绿。
 *  - 每个守卫都必须能真的变红。见文件末尾 `变异验证` 段落的说明。
 *
 * 运行：tsx tests/status-labels.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as STATUS_LABELS_MODULE from "../src/shared/status-labels";
import { OPPORTUNITY_ELEMENT_LABELS, labelOf } from "../src/shared/status-labels";

const {
  AUDIT_ACTION_LABELS,
  OPPORTUNITY_TYPE_LABELS,
  labelAuditAction,
  labelDecisionPacketStatus,
  labelKnowledgeSourceKind,
  labelLaunchMilestoneStatus,
  labelOpportunityElement,
  labelRunMode,
  labelValidationStatus,
} = STATUS_LABELS_MODULE;

const SRC = path.resolve(process.cwd(), "src");
const SKIP = new Set(["node_modules", ".next", ".next-verify", ".git"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** 剥注释并等长替换为空格（保留行号） */
const stripComments = (t: string) =>
  t
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|\s)\/\/[^\n]*/gm, (m, p1: string) => p1 + " ".repeat(m.length - p1.length));

const rel = (f: string) => path.relative(process.cwd(), f);

/**
 * 找出所有**自闭合**的 `<Badge ... />`，返回其属性区文本。
 *
 * 为什么不用正则：`/<Badge\b((?:(?!\/>)[\s\S])*?)\/>/g` 会把
 * `<Badge tone="ok">已完成</Badge>` 与紧随其后的 `<Badge status={x} />` 连成一片
 * ——因为前者的结束符是 `</Badge>` 而不是 `/>`，正则只能一路吃到后者的 `/>`，
 * 于是把「有 children 的正常写法」误报成泄漏（本守卫初版即栽在这里，误报 10 处）。
 *
 * 这里改为按字符扫描：从 `<Badge` 起，按引号/花括号深度找**开标签自己的** `>`，
 * 再看它前一个字符是不是 `/`。同时用 lastIndex 跳过已消费的片段。
 */
function findSelfClosingBadges(text: string): Array<{ index: number; inner: string }> {
  const out: Array<{ index: number; inner: string }> = [];
  const open = /<Badge\b/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(text))) {
    const attrStart = m.index + m[0].length;
    let i = attrStart;
    let brace = 0;
    let quote: string | null = null;
    let end = -1;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (brace > 0) {
        if (ch === '"' || ch === "'" || ch === "`") quote = ch;
        else if (ch === "{") brace++;
        else if (ch === "}") brace--;
        continue;
      }
      if (ch === "{") brace++;
      else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === ">") { end = i; break; }
      else if (ch === "<") break; // 上一个 Badge 未正常闭合，放弃本次
    }
    if (end < 0) continue;
    if (text[end - 1] === "/") {
      out.push({ index: m.index, inner: text.slice(attrStart, end - 1) });
    }
    open.lastIndex = end + 1;
  }
  return out;
}

// ---------------------------------------------------------------- 运行时语义

test("labelOf：映射不到时回退原始值，空值给占位符（不显示空白）", () => {
  assert.equal(labelOf({ A: "甲" }, "A"), "甲");
  // 回退而非空白——空白会让人以为数据丢了
  assert.equal(labelOf({ A: "甲" }, "Z"), "Z");
  assert.equal(labelOf({ A: "甲" }, null), "—");
  assert.equal(labelOf({ A: "甲" }, undefined), "—");
  assert.equal(labelOf({ A: "甲" }, ""), "—");
});

test("走查实际观察到的 8 个泄漏值，全部已有中文标签且不等于原始标识", () => {
  const observed: Array<[string, string]> = [
    [labelRunMode("TEST_STUB"), "TEST_STUB"],
    [labelDecisionPacketStatus("IN_REVIEW"), "IN_REVIEW"],
    // PENDING 在多个枚举里都有，取走查那一处实际命中的（打样里程碑）
    [labelLaunchMilestoneStatus("PENDING"), "PENDING"],
    [labelAuditAction("FEEDBACK_CREATED"), "FEEDBACK_CREATED"],
    [labelKnowledgeSourceKind("OBSIDIAN_VAULT"), "OBSIDIAN_VAULT"],
    [labelOpportunityElement("targetUserAndNeed"), "targetUserAndNeed"],
    [labelOpportunityElement("channelFit"), "channelFit"],
    [labelValidationStatus("VERIFIED_BY_LEAD"), "VERIFIED_BY_LEAD"],
  ];
  for (const [actual, raw] of observed) {
    assert.notEqual(actual, raw, `「${raw}」应被翻译成中文，而不是原样透出`);
    assert.ok(actual.trim().length > 0, `「${raw}」的标签不应为空`);
  }
});

test("所有已登记映射：值为非空中文、不含原始英文键名", () => {
  const maps: Array<[string, Record<string, string>]> = [
    ["OPPORTUNITY_TYPE_LABELS", OPPORTUNITY_TYPE_LABELS],
    ["OPPORTUNITY_ELEMENT_LABELS", OPPORTUNITY_ELEMENT_LABELS],
    ["AUDIT_ACTION_LABELS", AUDIT_ACTION_LABELS],
  ];
  // 动态取全部导出，避免新增映射却忘了纳入断言
  for (const [name, v] of Object.entries(STATUS_LABELS_MODULE)) {
    if (name.endsWith("_LABELS") && v && typeof v === "object") {
      maps.push([name, v as Record<string, string>]);
    }
  }
  assert.ok(maps.length >= 15, `动态发现的标签表过少（${maps.length}），断言可能已失效`);
  const seen = new Set<string>();
  for (const [name, m] of maps) {
    if (seen.has(name)) continue;
    seen.add(name);
    for (const [k, val] of Object.entries(m)) {
      assert.ok(val && val.trim().length > 0, `${name}.${k} 的标签不能为空`);
      assert.ok(/[\u4e00-\u9fa5]/.test(val), `${name}.${k} 的标签「${val}」不含中文，疑似仍在透出英文`);
    }
  }
});

// ---------------------------------------------------------------- 源码守卫

test("守卫 1：标签模块必须零依赖（客户端可直接 import）", () => {
  const f = path.join(SRC, "shared/status-labels.ts");
  const text = stripComments(fs.readFileSync(f, "utf8"));
  const imports = [...text.matchAll(/^\s*import\s.+$/gm)].map((m) => m[0].trim());
  assert.deepEqual(
    imports,
    [],
    `status-labels.ts 被客户端组件直接引入，一旦 import 服务端模块（prisma/server-only）客户端打包即失败。\n` +
      `当前导入：\n${imports.join("\n")}`,
  );
});

test("守卫 2：八要素标签的键必须与 OpportunityElementKey 联合类型完全一致", () => {
  const src = fs.readFileSync(path.join(SRC, "modules/research/opportunity-analysis.ts"), "utf8");
  const m = src.match(/export type OpportunityElementKey\s*=([\s\S]*?);/);
  assert.ok(m, "未能在 opportunity-analysis.ts 中找到 OpportunityElementKey 定义");
  const typeKeys = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
  const labelKeys = Object.keys(OPPORTUNITY_ELEMENT_LABELS).sort();
  assert.deepEqual(
    labelKeys,
    typeKeys,
    "八要素标签与类型定义不同步——新增/重命名字段时必须一并登记中文标签，否则界面会露出英文键名",
  );
});

test("守卫 3：全仓写入的审计动作，必须都在 AUDIT_ACTION_LABELS 中有中文标签", () => {
  const files = walk(SRC).filter((f) => /\.tsx?$/.test(f));
  const written = new Set<string>();
  for (const f of files) {
    const text = stripComments(fs.readFileSync(f, "utf8"));
    for (const m of text.matchAll(/\baction:\s*"([A-Z_]{3,})"/g)) written.add(m[1]);
  }
  assert.ok(written.size > 20, `审计动作取样过少（${written.size}），守卫可能已失效`);
  const missing = [...written].filter((a) => !(a in AUDIT_ACTION_LABELS)).sort();
  assert.deepEqual(
    missing,
    [],
    `以下审计动作已写入但未登记中文标签，界面会显示英文常量：\n${missing.join("\n")}`,
  );
});

/**
 * 守卫 4：JSX 文本子节点不得直接渲染"裸枚举字段"。
 * 泄漏形态： `>{x.status}<` / `>{project.mode}<` / `>{el.key}<`
 * 正确形态： `>{labelXxx(x.status)}<`（内含括号，正则不会命中）
 */
test("守卫 4：JSX 中不得直接把枚举字段作为文本子节点渲染", () => {
  const ENUM_FIELDS = [
    "status",
    "kind",
    "mode",
    "action",
    "stage",
    "nature",
    "type",
    "verifyStatus",
    "validationStatus",
    "applicabilityStatus",
    "syncStatus",
    "reviewStatus",
    "disposition",
    "outcome",
    "decision",
  ];
  const fieldAlt = ENUM_FIELDS.join("|");
  // >{a.b.status}<  或  >{a.status}<（成员表达式整体作为文本子节点）
  const re = new RegExp(
    `>\\s*\\{\\s*[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*\\.(${fieldAlt})\\s*\\}\\s*<`,
    "g",
  );

  const files = walk(SRC).filter((f) => /\.tsx$/.test(f));
  const offenses: string[] = [];
  for (const f of files) {
    const text = stripComments(fs.readFileSync(f, "utf8"));
    for (const m of text.matchAll(re)) {
      const line = text.slice(0, m.index ?? 0).split("\n").length;
      const where = `${rel(f)}:${line}`;
      offenses.push(`${where} → ${m[0].trim()}`);
    }
  }
  assert.deepEqual(
    offenses,
    [],
    `以下位置把内部枚举直接显示给使用者，请改用 src/shared/status-labels.ts 的 label* 函数：\n${offenses.join("\n")}`,
  );
});

/**
 * 守卫 5：`<Badge status={x} />`（无 children）会把 status 原样当文本渲染。
 * 这个是守卫 4 的盲区——`>` 后面不是 `{` 而是组件自闭合，正则抓不到。
 */
test("守卫 5：<Badge status={...} /> 自闭合形态必须补上中文 children", () => {
  const files = walk(SRC).filter((f) => /\.tsx$/.test(f));
  const offenses: string[] = [];
  for (const f of files) {
    const text = stripComments(fs.readFileSync(f, "utf8"));
    for (const { index, inner } of findSelfClosingBadges(text)) {
      if (!/\bstatus\s*=/.test(inner)) continue; // 无 status 属性 → 必然另有 children 来源
      const line = text.slice(0, index).split("\n").length;
      offenses.push(`${rel(f)}:${line} → <Badge${inner.trim().slice(0, 60)} />`);
    }
  }
  assert.deepEqual(
    offenses,
    [],
    `Badge 无 children 时会把 status 原样渲染成文本。请显式给出中文：\n` +
      `<Badge status={x.status}>{labelXxxStatus(x.status)}</Badge>\n${offenses.join("\n")}`,
  );
});

/**
 * 守卫 6：共享标签表的键必须与「定义处」完全一致。
 *
 * 收口到一张表只是第一步——表本身会不会漏键、会不会与类型分叉，得有人盯。
 * 这里的每个「定义处」都是仓里真实的权威来源（prisma 枚举 / TS 联合类型）。
 */
test("守卫 6：共享标签表的键必须覆盖权威定义的全部取值", () => {
  const schema = fs.readFileSync(path.resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
  const prismaEnum = (name: string): string[] => {
    const m = schema.match(new RegExp(`enum ${name}\\s*\\{([^}]*)\\}`));
    assert.ok(m, `prisma/schema.prisma 中未找到 enum ${name}`);
    return m![1].split("\n").map((x) => x.trim()).filter((x) => x && !x.startsWith("//"));
  };
  const tsUnion = (file: string, typeName: string): string[] => {
    const text = fs.readFileSync(path.join(SRC, file), "utf8");
    const m = text.match(new RegExp(`export type ${typeName}\\s*=([\\s\\S]*?);`));
    assert.ok(m, `${file} 中未找到 export type ${typeName}`);
    return [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  };

  const cases: Array<[string, string[], object]> = [
    ["ProjectStage（prisma 枚举）", prismaEnum("ProjectStage"), (STATUS_LABELS_MODULE as any).PROJECT_STAGE_LABELS],
    ["ProductLifecycleStage（prisma 枚举）", prismaEnum("ProductLifecycleStage"), (STATUS_LABELS_MODULE as any).PRODUCT_LIFECYCLE_STAGE_LABELS],
    ["AnalysisDimensionKey（prisma 枚举）", prismaEnum("AnalysisDimensionKey"), (STATUS_LABELS_MODULE as any).SCORE_DIMENSION_LABELS],
    ["ProductSpecField（revision.ts 联合类型）", tsUnion("modules/product-development/revision.ts", "ProductSpecField"), (STATUS_LABELS_MODULE as any).PRODUCT_SPEC_FIELD_LABELS],
    ["MilestoneKind（launch/service.ts 联合类型）", tsUnion("modules/launch/service.ts", "MilestoneKind"), (STATUS_LABELS_MODULE as any).LAUNCH_MILESTONE_KIND_LABELS],
    ["WorkExecutorType（prisma 枚举）", prismaEnum("WorkExecutorType"), (STATUS_LABELS_MODULE as any).WORK_EXECUTOR_TYPE_LABELS],
  ];

  for (const [what, keys, map] of cases) {
    assert.ok(map, `${what} 对应的共享标签表不存在`);
    assert.deepEqual(
      Object.keys(map as Record<string, string>).sort(),
      [...keys].sort(),
      `${what} 与共享标签表不同步——新增取值时必须一并登记中文标签，否则界面会露出英文标识`,
    );
  }
});

/**
 * 守卫 7：阶段 / 维度 / 字段这类标签表不得在别处重复定义。
 *
 * 走查前，同一张「产品生命周期」表在 5 个文件里各存一份、项目阶段表在 2 个文件里各存一份，
 * 且两个阶段轴上出现了互相冲突的中文——分叉是静默的，改一处不会有人发现。
 * 这里把「只允许有一处」变成断言。
 */
test("守卫 7：标签表不得在 shared/status-labels.ts 之外重复定义", () => {
  const NAMES = [
    "LIFECYCLE_LABELS",
    "STAGE_LABELS",
    "stageLabels",
    "DIM_LABELS",
    "DIMENSION_LABELS",
    "KIND_LABELS",
    "STATUS_LABELS",
    "VERIFY_LABELS",
    "NATURE_LABELS",
    "VALIDATION_LABELS",
    "FIELD_LABELS",
  ];
  // 也覆盖 `export const` —— 只认裸 `const` 会留一个「导出一下就绕过」的口子
  const defRe = new RegExp(`^(?:export\\s+)?const\\s+(${NAMES.join("|")})\\b(.*)$`);
  /**
   * 豁免「别名」写法：`export const X_LABELS: Record<T, string> = SHARED_LABELS;`
   * 这种是**引用唯一来源**并保留自己的类型约束，不是又抄一份表——服务端模块
   * 需要 `Record<枚举, string>` 的强类型，而共享层是 `Record<string, string>`。
   */
  const ALIAS = /=\s*[A-Za-z_$][\w$]*_LABELS\s*;/;
  const canary = path.join(SRC, "shared", "status-labels.ts");
  const offenders: string[] = [];
  for (const f of walk(SRC)) {
    if (!/\.tsx?$/.test(f) || f === canary) continue;
    const lines = stripComments(fs.readFileSync(f, "utf8")).split("\n");
    lines.forEach((line, idx) => {
      if (!defRe.test(line)) return;
      if (ALIAS.test(line)) return;
      offenders.push(`${rel(f)}:${idx + 1} → ${line.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `以下文件重新定义了应统一到 src/shared/status-labels.ts 的标签表：\n${offenders.join("\n")}`,
  );
});

/**
 * 守卫 8：模块层审计文案（`summary:` 模板）不得内嵌裸枚举。
 *
 * 真阳性案例（2026-09-18 小屏全矩阵 R4，/trace 时间线逐字渲染审计 summary）：
 *   - `状态 ${existing.status} → ${status}`（launch/service.ts）
 *   - `状态流转为 IN_REVIEW`（decisions/service.ts）
 *   - `状态变更为 ${newStatus}`（api/evidences/[id]/verify/route.ts）
 * 守卫 4/5 只盯 **JSX**，模块层的**文案模板**此前没有护栏——这里补上。
 *
 * 两条规则：
 *   R8.1 文案的**字面量部分**不得出现任何已登记枚举的原始标识（IN_REVIEW / PENDING …）；
 *   R8.2 插值不得是「纯枚举字段成员路径」（`${x.status}` / `${x.verifyStatus}`），必须包 `label*()`。
 * 与「回退而非空白」的取舍一致：漏登记是信号，但把英文标识透给使用者是事故，两者都要在 CI 前挡住。
 */
test("守卫 8：模块层审计文案（summary 模板）不得内嵌裸枚举", () => {
  // 已知内部标识全集 = status-labels 里所有 *_LABELS 的键（自维护，新增映射即自动纳入）
  const knownTokens = new Set<string>();
  for (const [n, v] of Object.entries(STATUS_LABELS_MODULE)) {
    if (n.endsWith("_LABELS") && v && typeof v === "object") {
      for (const k of Object.keys(v as Record<string, string>)) knownTokens.add(k);
    }
  }
  assert.ok(knownTokens.size > 80, `枚举标识取样过少（${knownTokens.size}），守卫可能已失效`);

  // 末段后缀匹配（大小写无关），故能同时覆盖 `.status` 与 `newStatus` / `runMode` 这类驼峰命名。
  // 有意不含 `type`：`params.targetType`（collaboration）是自由字符串锚点，非枚举。
  const ENUM_FIELDS = [
    "status", "stage", "mode", "kind", "nature", "outcome", "decision",
    "disposition", "verifyStatus", "validationStatus", "applicabilityStatus",
    "syncStatus", "reviewStatus",
  ];
  const barePath = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

  const files = walk(SRC).filter(
    (f) => /\.ts$/.test(f) && /[\\/](modules|app[\\/]api)[\\/]/.test(f),
  );
  const offenses: string[] = [];
  for (const f of files) {
    const text = stripComments(fs.readFileSync(f, "utf8"));
    for (const m of text.matchAll(/summary:\s*`([^`]*)`/g)) {
      const body = m[1];
      const line = text.slice(0, m.index ?? 0).split("\n").length;
      // R8.1：只扫字面量（剥掉 ${...}，否则 labelX(X.IN_REVIEW) 的实参会被误判）
      const literalOnly = body.replace(/\$\{[^}]*\}/g, " ");
      for (const tok of knownTokens) {
        if (new RegExp(`(?:^|[^\\w$])${tok}(?![\\w$])`).test(literalOnly)) {
          offenses.push(`${rel(f)}:${line} → 文案内嵌裸枚举「${tok}」`);
        }
      }
      // R8.2：纯成员路径插值且末段像枚举字段 → 未中文化
      for (const im of body.matchAll(/\$\{([^}]*)\}/g)) {
        const expr = im[1].trim();
        if (!barePath.test(expr)) continue;
        const last = expr.split(".").pop()!.toLowerCase();
        if (ENUM_FIELDS.some((x) => last.endsWith(x.toLowerCase()))) {
          offenses.push(`${rel(f)}:${line} → 直接插值枚举字段「${expr}」，应改用 label*()`);
        }
      }
    }
  }
  assert.deepEqual(offenses, [], `以下模块层审计文案会把内部枚举透给使用者：\n${offenses.join("\n")}`);
});

test("变异验证：守卫确实能变红（不是恒绿的空断言）", () => {
  const probe = `>\\s*\\{\\s*[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*\\.(status|mode|kind)\\s*\\}\\s*<`;
  const re = new RegExp(probe, "g");
  assert.ok('>{pkt.status}<'.match(re), "守卫 4 的正则应命中泄漏形态 >{pkt.status}<");
  assert.equal('>{labelDecisionPacketStatus(pkt.status)}<'.match(re), null, "守卫 4 不应误伤已中文化的写法");

  // 守卫 5 用的是字符扫描而非正则——这里直接验扫描器本身的判定
  const scan = (t: string) => findSelfClosingBadges(t).map((x) => x.inner.trim());
  assert.deepEqual(
    scan('<Badge status={m.status} />'),
    ["status={m.status}"],
    "扫描器应识别出无 children 的自闭合 Badge",
  );
  assert.deepEqual(
    scan('<Badge tone="ok">已完成</Badge>'),
    [],
    "扫描器不得把有 children 的 Badge 误判为自闭合（初版正则在此误报 10 处）",
  );
  assert.deepEqual(
    scan('<Badge tone="ok">已完成</Badge>\n<Badge status={a.status} />'),
    ["status={a.status}"],
    "扫描器必须能跨过有 children 的 Badge，只报后面那个真泄漏",
  );
  assert.deepEqual(
    scan('<Badge tone={x === "a" ? "ok" : "warn"}>{label(x.status)}</Badge>'),
    [],
    "属性里的花括号表达式含引号时不得错判",
  );

  // 守卫 7：本地表回归时其正则必须命中（含 `export const` 形态）
  const dup = new RegExp(
    `^(?:export\\s+)?const\\s+(${["LIFECYCLE_LABELS", "STAGE_LABELS", "DIMENSION_LABELS"].join("|")})\\b`,
    "gm",
  );
  assert.ok(
    "const LIFECYCLE_LABELS: Record<string, string> = {".match(dup),
    "守卫 7 的正则应命中被重新定义的本地标签表",
  );
  assert.ok(
    "export const STAGE_LABELS: Record<string, string> = {".match(new RegExp(dup.source, "gm")),
    "守卫 7 也应命中 `export const` 形态（否则导出一下就绕过了）",
  );
  assert.equal(
    "  const labelOf = (m, k) => k;".match(new RegExp(dup.source, "gm")),
    null,
    "守卫 7 不应误伤非定义处",
  );
  // 守卫 7 只在行首命中，缩进的同名引用不算重复定义
  assert.equal(
    "    LIFECYCLE_LABELS[stage],".match(new RegExp(dup.source, "gm")),
    null,
    "守卫 7 不应把使用点当成定义",
  );

  // 守卫 7 的别名豁免：引用唯一来源（并保留强类型）不算重复定义
  const ALIAS = /=\s*[A-Za-z_$][\w$]*_LABELS\s*;/;
  assert.ok(
    ALIAS.test("export const FIELD_LABELS: Record<ProductSpecField, string> = PRODUCT_SPEC_FIELD_LABELS;"),
    "守卫 7 应豁免「别名到唯一来源」的写法",
  );
  assert.ok(
    ALIAS.test("export const DIMENSION_LABELS: Record<AnalysisDimensionKey, string> = SCORE_DIMENSION_LABELS;"),
    "守卫 7 应豁免带类型约束的别名",
  );
  assert.equal(
    ALIAS.test("const LIFECYCLE_LABELS: Record<string, string> = {"),
    false,
    "守卫 7 不应豁免真正的重复表（右值是对象字面量）",
  );

  // 守卫 6：键不一致时必须判不等（模拟共享表漏登记一个取值）
  assert.throws(
    () => assert.deepEqual(["A", "B"].sort(), ["A"].sort()),
    "守卫 6 的比对方式在漏键时必须抛错",
  );

  // 守卫 8：文案模板的裸枚举识别必须能变红，且不误伤已中文化写法
  const barePath = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
  const isEnumField = (expr: string) =>
    barePath.test(expr) &&
    ["status", "decision", "verifyStatus"].some((x) =>
      expr.split(".").pop()!.toLowerCase().endsWith(x.toLowerCase()),
    );
  assert.ok(isEnumField("existing.status"), "守卫 8 应命中 ${existing.status}");
  assert.ok(isEnumField("newStatus"), "守卫 8 应命中驼峰后缀 ${newStatus}");
  assert.ok(isEnumField("params.decision"), "守卫 8 应命中 ${params.decision}");
  assert.equal(
    isEnumField("labelDecisionOutcome(params.decision)"),
    false,
    "守卫 8 不应误伤已用 label*() 中文化的插值",
  );
  assert.equal(isEnumField("params.targetType"), false, "守卫 8 不应误伤非枚举的 targetType");
  const lit8 = (s: string) => s.replace(/\$\{[^}]*\}/g, " ");
  assert.ok(
    /(?:^|[^\w$])IN_REVIEW(?![\\w$])/.test(lit8("状态流转为 IN_REVIEW")),
    "守卫 8 的 R8.1 应命中字面量里的 IN_REVIEW",
  );
  assert.equal(
    /(?:^|[^\w$])IN_REVIEW(?![\\w$])/.test(lit8("状态流转为 ${labelDecisionPacketStatus(DecisionPacketStatus.IN_REVIEW)}")),
    false,
    "守卫 8 的 R8.1 不应把 label*() 实参里的枚举当泄漏",
  );
});


test("项目详情表单不得在 option 文案里透出内部枚举", () => {
  const file = path.join(SRC, "app/projects/[id]/project-detail-client.tsx");
  const text = stripComments(fs.readFileSync(file, "utf8"));
  const rawOption = /<option\b[^>]*>\s*[^<{]*\b(?:IN_PROGRESS|VERIFIED_BY_LEAD|HUMAN|TEST_AGENT|DIGITAL_WORKER|MANUAL|TEST_STUB|RESEARCH_REPORT|SAMPLE_ROUND|SUPPLIER_QUOTE|PROFESSIONAL_CONFIRMATION|PACKAGING_BRIEF|PRODUCTION_PLAN|PRODUCTION_RECORD|COST_SCENARIO|REAL|DEMO)\b[^<{]*<\/option>/g;
  const offenses = [...text.matchAll(rawOption)].map((m) => m[0]);
  assert.deepEqual(
    offenses,
    [],
    `项目详情表单仍有内部枚举直接显示给用户：\n${offenses.join("\n")}`
  );
  assert.ok(text.includes('labelWorkExecutorType("DIGITAL_WORKER")'));
  assert.ok(text.includes('labelArtifactType("RESEARCH_REPORT")'));
  assert.ok(text.includes('labelRunMode("TEST_STUB")'));
  assert.ok(text.includes('labelEvidenceNature("DEMO")'));
});