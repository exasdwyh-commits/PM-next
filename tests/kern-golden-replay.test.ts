/**
 * 黄金对话重放 harness（确定性层）：把用户报告的三个缺陷焊成不变量。
 * 与单元级回归不同，这里重放的是**整条纯决策管线**——
 *   ① conversationProductGoal → routeIntent → decideMissionLaunch → buildNewProductMissionPlan
 *      （“只是对话几轮”也能进研发；拒绝/引用/闲聊绝不进）
 *   ③ runToolLoop（leaky-provider 脚本回放 ff812eee 实录）→ 交付正文不得含工具复读
 *   ④ buildNewProductMissionPlan → missionDependencyKeys → missionOutputText →
 *      truncateUpstreamForPrompt / renderMissionUpstream（GTM 尾部必须活到综合节点输入）
 * 全部纯函数 + 脚本化 invoker：不碰数据库、不调模型、CI 可跑、零花费。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { conversationProductGoal } from "../src/modules/assistant-runtime/product-goal";
import { routeIntent } from "../src/modules/assistant-runtime/router";
import { buildNewProductMissionPlan, decideMissionLaunch } from "../src/modules/supervisor/plan";
import {
  missionDependencyKeys,
  missionOutputText,
  renderMissionUpstream,
  truncateUpstreamForPrompt,
} from "../src/modules/supervisor/handoff";
import { runToolLoop, stripToolRequestNoise } from "../src/modules/supervisor/tools";

const collab = (mode: string, experts: string[] = []) => ({
  version: "kern-collaboration-shadow/v1" as const,
  mode: mode as "SOLO",
  experts,
  synthesisTier: "FRONTIER" as const,
  researchRequired: true,
  independentFirstPass: experts.length > 1,
  qaRequired: mode === "COUNCIL",
  redTeamRequired: false,
  autoDispatchCandidate: false,
  autoDispatchEligible: false,
  authority: "ADVISORY_ONLY" as const,
  source: "DETERMINISTIC" as const,
  reasons: [],
});

// ---------------------------------------------------------------------------
// G1：多轮对话 → 研发任务（用户报告①：对话几轮没进研发）
// ---------------------------------------------------------------------------

test("G1a：先聊几轮再说目标约束——延续的研发锚点必须带进任务决策并生成九节点图", () => {
  const history = [
    { role: "USER", content: "我们想开发一款人参多糖肽植物饮品，面向熬夜亚健康人群" },
    { role: "ASSISTANT", content: "方向收到。想先了解：预算和渠道有什么初步想法吗？" },
  ];
  const turn = "预算大概 5 万以内，先走内容电商试试";
  const goal = conversationProductGoal(turn, history);
  assert.ok(goal, "跟进轮必须延续出研发目标");
  assert.match(goal, /人参多糖肽/, "锚点（开发意图原话）必须在目标里");
  assert.match(goal, /内容电商/, "后续约束必须并入目标");
  const intent = routeIntent(turn, false);
  const decision = decideMissionLaunch({ text: turn, intent, collaboration: collab("SOLO"), productBound: false, productDevelopmentGoal: goal });
  assert.deepEqual([decision.launch, decision.playbook, decision.reason], [true, "NEW_PRODUCT", "NEW_PRODUCT_GOAL"]);
  const plan = buildNewProductMissionPlan(goal);
  const keys = plan.nodes.map((n) => n.key);
  for (const required of ["market", "compliance", "economics", "opportunity", "validation", "gtm", "red-team", "qa", "synthesis"]) {
    assert.ok(keys.includes(required), `新产品计划缺少节点 ${required}`);
  }
  assert.equal(plan.goal.includes("内容电商"), true, "简报/计划的目标要用延续后的完整目标");
});

test("G1b：闲聊、拒绝、引用转述——三条都不许误进研发", () => {
  const anchor = [{ role: "USER", content: "我们打算做一款新的即饮产品" }];
  // 纯闲聊跟进
  const chat = conversationProductGoal("今天有什么任务", anchor);
  assert.equal(chat, null);
  assert.equal(decideMissionLaunch({ text: "今天有什么任务", intent: routeIntent("今天有什么任务", true), collaboration: collab("SOLO"), productDevelopmentGoal: chat }).launch, false);
  // 明确拒绝后再提关键词也不进
  const declined = conversationProductGoal("不用开发产品了，只是想聊聊这个市场", [...anchor, { role: "ASSISTANT", content: "好的，那我们先聊市场。" }]);
  assert.equal(declined, null);
  const d2 = decideMissionLaunch({ text: "不用开发产品了，只是想聊聊这个市场", intent: "UNSUPPORTED", collaboration: collab("SOLO"), productDevelopmentGoal: declined });
  assert.deepEqual([d2.launch, d2.reason], [false, "USER_DECLINED_MISSION"]);
  // 引用别人的开发意向 ≠ 自己的开发意向
  const quoted = conversationProductGoal("引用：某公司想开发一款饮料，他们的渠道是怎么铺的", anchor);
  assert.equal(quoted, null);
  const d3 = decideMissionLaunch({ text: "引用：某公司想开发一款饮料，他们的渠道是怎么铺的", intent: "UNSUPPORTED", collaboration: collab("SOLO"), productDevelopmentGoal: quoted });
  assert.equal(d3.launch, false);
});

// ---------------------------------------------------------------------------
// G2：leaky-provider 复读回放（用户报告③：报告里出现「数据库代码结构」）
//     素材取自 mission ff812eee market 节点的 node.finished 实录前缀。
// ---------------------------------------------------------------------------

const LEAKY_FINAL =
  '{"tool":"web_search","input":{"query":"中国 中老年营养奶粉 价格 乳铁蛋白 红参 褐藻寡糖 2025"}}\n' +
  "%timeout\n" +
  '{"tool":"web_search","input":{"query":"中老年奶粉 市场规模 中国 2024 2025"}}\n' +
  '{"tool":"knowledge_search","input":{"query":"中老年营养奶粉 市场 竞品 价格 渠道 用户需求"}}\n' +
  "### 研究边界\n\n- 当前资料只提供了产品构想、目标人群与预算，未提供可核验的市场数据。（事实）";

test("G2a：工具循环最终答复不得以工具请求行/代码结构交付——用户看到的正文从标题开始", async () => {
  const replies = [
    "```kern-tool\n" + JSON.stringify({ tool: "knowledge_search", input: { query: "中老年营养奶粉 市场 竞品" } }) + "\n```",
    LEAKY_FINAL,
  ];
  let idx = 0;
  const out = await runToolLoop({
    messages: [{ role: "user", content: "研究目标市场" }],
    invoke: async () => ({ text: replies[Math.min(idx++, replies.length - 1)], provenance: { provider: "leaky-replay", modelId: "m" } }),
    ctx: { organizationId: "o", searchKnowledge: async () => [{ title: "竞品表", snippet: "伊利 128 元", ref: "k1" }] },
  });
  const text = (out as { text: string }).text;
  assert.doesNotMatch(text, /^\s*\{?["']?tool/m, "交付正文不得以工具请求开头");
  assert.ok(!text.includes("%timeout"), "%timeout 分隔行不得进入交付");
  assert.ok(!text.includes('{"tool"'), "裸 JSON 工具行不得进入交付");
  assert.ok(text.startsWith("### 研究边界"), "结论正文完整保留");
  assert.equal(out.toolCalls?.length, 1, "复读不得触发第二次工具执行");
});

test("G2b：交付正文沿交接链透传——综合节点输入里同样没有代码结构", () => {
  const cleaned = stripToolRequestNoise(LEAKY_FINAL);
  assert.ok(cleaned && cleaned.startsWith("### 研究边界"));
  const result = { kind: "MISSION_NODE_OUTPUT", nodeKey: "market", output: cleaned };
  const carried = missionOutputText(result, cleaned.slice(0, 4000));
  assert.equal(carried, cleaned);
  const prompt = renderMissionUpstream([{ key: "market", agentCode: "research_agent", status: "SUCCEEDED", summary: carried }]);
  assert.ok(!prompt.includes('{"tool"') && !prompt.includes("%timeout"), "综合节点的上游区块不得携带工具复读");
});

// ---------------------------------------------------------------------------
// G3：GTM 尾部保护（用户报告④：上游 GTM 交付被截断，渠道建议与验证动作丢失）
// ---------------------------------------------------------------------------

test("G3a：synthesis 的上游必须含 gtm，且长输出的头尾都活着、截断处显式标记", () => {
  const plan = buildNewProductMissionPlan("开发一款人参多糖肽饮品");
  const deps = missionDependencyKeys(plan.nodes, "synthesis");
  assert.ok(deps.includes("gtm"), "传递闭包必须把 gtm 交给综合节点（QA 的直接依赖里没有它）");
  assert.ok(deps.includes("market") && deps.includes("red-team") && deps.includes("validation"));

  const filler = "中".repeat(13_000); // 总长约 13075 > 12000 截断预算
  const gtmFull = `## 上市与营销策略\n渠道优先级：先内容电商种草，再私域承接。\n${filler}\n渠道建议：远方好物等私域平台首发，天猫承接搜索。验证动作：测试复购率与客单价，两周出结论。`;
  const truncated = truncateUpstreamForPrompt(gtmFull);
  assert.ok(truncated.startsWith("## 上市与营销策略"), "头部保留");
  assert.ok(truncated.includes("验证动作：测试复购率与客单价"), "尾部（用户点名要的渠道建议与验证动作）保留");
  assert.match(truncated, /中间略去|为控制上下文/, "截断处必须显式标记，不得静默掐尾");
  assert.ok(truncated.includes("UNKNOWN"), "截断声明必须禁止下游拿缺失部分编造");

  // 全文优先于 4000 字摘要：executorResult.output 是权威载体
  const viaResult = missionOutputText({ kind: "MISSION_NODE_OUTPUT", nodeKey: "gtm", output: gtmFull }, gtmFull.slice(0, 4000));
  assert.equal(viaResult, gtmFull, "节点产出全文必须优先于运行摘要");
});

test("G3b：gtm 真失败时综合输入如实 UNKNOWN——截断与失败都不许被伪装成完整", () => {
  const failed = renderMissionUpstream([
    { key: "market", agentCode: "research_agent", status: "SUCCEEDED", summary: "### 研究边界\n资料有限。（事实）" },
    { key: "gtm", agentCode: "marketing_agent", status: "FAILED", summary: null },
  ]);
  assert.match(failed, /gtm.*未能完成 → 视为 UNKNOWN/s);
  const emptyButSucceeded = renderMissionUpstream([{ key: "gtm", agentCode: "marketing_agent", status: "SUCCEEDED", summary: null }]);
  assert.match(emptyButSucceeded, /无产出/, "成功但空产出同样如实标注，不许编上游");
});
