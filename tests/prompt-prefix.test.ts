/**
 * KX-70 提示词静态前缀稳定守卫。
 *
 * 目的：让提示缓存（prompt caching）真正命中——system prompt 的静态部分必须
 *   (a) 纯函数：同样输入任何时刻都逐字相同（不掺日期、随机数、环境变量）；
 *   (b) 排在最前：记忆、运行时选择、组织事实、上游产出等易变内容只能跟在后面；
 *   (c) 改了就升版本：静态前缀的哈希变了，DEPARTMENT_ASSISTANT_PERSONA_VERSION 也必须变，
 *       这样缓存失效是有意为之、可追溯的。
 *
 * 基线：tests/fixtures/prompt-prefix-baseline.json（`npm run arch:baseline` 一并重写）。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildDepartmentAssistantSystemPrompt } from "../src/modules/assistant-runtime/persona";
import { PREFIX_TASK_CLASSES as TASK_CLASSES, currentPrefixBaseline, type PrefixBaseline } from "./helpers/prompt-prefix";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const BASELINE = path.join(ROOT, "tests", "fixtures", "prompt-prefix-baseline.json");
const VOLATILE = [/\b20\d\d-\d\d-\d\d\b/, /\d{1,2}:\d\d(:\d\d)?/, /今天|现在时间|当前时间|本周/, /Date\(/];

test("PP1：静态前缀是纯函数——换时间、换时区、重复调用，输出逐字相同", () => {
  const realNow = Date.now;
  const realTZ = process.env.TZ;
  try {
    const first = TASK_CLASSES.map((tc) => buildDepartmentAssistantSystemPrompt(tc, "公司身份层示例"));
    Date.now = () => 0;
    process.env.TZ = "America/New_York";
    const second = TASK_CLASSES.map((tc) => buildDepartmentAssistantSystemPrompt(tc, "公司身份层示例"));
    assert.deepEqual(second, first);
  } finally {
    Date.now = realNow;
    if (realTZ === undefined) delete process.env.TZ;
    else process.env.TZ = realTZ;
  }
  for (const tc of TASK_CLASSES) {
    const p = buildDepartmentAssistantSystemPrompt(tc, null) ?? "";
    assert.ok(p.length > 200, `${tc} 应有静态 persona`);
    for (const re of VOLATILE) assert.equal(re.test(p), false, `${tc} 的静态前缀里出现了易变内容 ${re}`);
  }
  assert.equal(buildDepartmentAssistantSystemPrompt("RESEARCH_SYNTHESIS", null), null, "非助理任务类不套 persona");
});

test("PP2：对话引擎的 system 消息按「静态 persona → 记忆 → 运行时选择」排列，静态在前", () => {
  const engine = read("src/modules/assistant-runtime/conversation-engine.ts");
  const m = engine.match(/const assistantPersona = \[([^\]]+)\]/);
  assert.ok(m, "conversation-engine 应以数组拼装 assistantPersona");
  const parts = m![1].split(",").map((s) => s.trim()).filter(Boolean);
  assert.equal(parts[0], "basePersona", `静态 persona 必须排第一，实际顺序：${parts.join(" → ")}`);
  assert.ok(parts.indexOf("memoryPrompt") > 0, "记忆片段必须在静态前缀之后");
  const personaLine = engine.indexOf("buildDepartmentAssistantSystemPrompt(");
  assert.ok(personaLine > 0);
  const personaCall = engine.slice(personaLine, engine.indexOf(")", personaLine));
  assert.equal(/Date|now|today/i.test(personaCall), false, "不要把时间传进静态 persona");
});

test("PP3：任务节点的 system 消息只含静态内容；记忆、组织事实、上游产出放在 user 消息里", () => {
  const src = read("src/modules/supervisor/generic-executor.ts");
  const closeAfter = (from: number) => {
    const m = /\]\s*\.filter\(Boolean\)/.exec(src.slice(from));
    return m ? from + m.index : -1;
  };
  const start = src.indexOf("const system = [");
  const end = closeAfter(start);
  assert.ok(start > 0 && end > start, "buildMissionNodeMessages 的 system 数组形态变了，请同步更新本守卫");
  const systemBlock = src.slice(start, end);
  for (const forbidden of ["memory", "facts", "upstream", "revisionFeedback", "userInputs", "new Date", "toISOString"]) {
    assert.equal(systemBlock.includes(forbidden), false, `system 消息里不应出现易变内容「${forbidden}」`);
  }
  const userStart = src.indexOf("const user = [", end);
  const userBlock = src.slice(userStart, closeAfter(userStart));
  for (const required of ["memory", "facts", "upstream"]) {
    assert.ok(userBlock.includes(required), `易变内容「${required}」应在 user 消息里`);
  }
});

test("PP4：静态前缀变了必须升 persona 版本号（缓存失效要有意为之）", () => {
  const now = currentPrefixBaseline();
  const saved = JSON.parse(fs.readFileSync(BASELINE, "utf8")) as PrefixBaseline;
  const changed = TASK_CLASSES.filter((tc) => saved.hashes[tc] !== now.hashes[tc]);
  if (changed.length) {
    assert.notEqual(
      now.version,
      saved.version,
      `静态前缀变了（${changed.join(", ")}）但 DEPARTMENT_ASSISTANT_PERSONA_VERSION 仍是 ${saved.version}。升版本后运行 \`npm run arch:baseline\`。`
    );
  }
  assert.deepEqual(now, { ...saved, note: now.note }, "版本或哈希与基线不一致：运行 `npm run arch:baseline` 重写基线并提交。");
});
