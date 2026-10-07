import assert from "node:assert/strict";
import test from "node:test";
import { extractExplicitMemory, extractTopics, relevance, selectMemories, renderMemoryPrompt, topicOverlap, MAX_CORRECTIONS_INJECTED } from "../src/modules/memory";

test("explicit memory: only clear '记住/以后' statements", () => {
  assert.equal(extractExplicitMemory("记住：我们只做跨境电商。")?.content, "我们只做跨境电商");
  assert.equal(extractExplicitMemory("以后报告都用英文")?.content, "报告都用英文");
  assert.equal(extractExplicitMemory("我想开发一个新产品"), null);
});

test("selection: preferences always, outcomes by relevance", () => {
  const now = new Date();
  const items = [
    { id: "p", kind: "PREFERENCE", content: "预算上限 5 万", pinned: false, createdAt: now },
    { id: "o1", kind: "OUTCOME", content: "「宠物饮水机」的结论：东南亚渠道成本偏高", pinned: false, createdAt: now },
    { id: "o2", kind: "OUTCOME", content: "「咖啡器具」的结论：做便携套装", pinned: false, createdAt: now },
  ];
  const chosen = selectMemories(items, "再评估一下宠物饮水机的东南亚市场");
  assert.deepEqual(chosen.map((m) => m.id), ["p", "o1"]);
  assert.ok(relevance("宠物饮水机", items[2].content) < 0.12);
  assert.match(renderMemoryPrompt(chosen), /\[偏好\] 预算上限/);
});

test("KX-74 topics: deterministic tags, stop-words dropped, latin kept", () => {
  const t = extractTopics("我想开发一个宠物饮水机，面向东南亚市场，用 Shopee 卖");
  assert.ok(t.includes("shopee"));
  assert.ok(t.some((x) => x.includes("宠物") || x.includes("饮水")), JSON.stringify(t));
  assert.ok(!t.includes("我想") && !t.includes("一个"));
  assert.deepEqual(extractTopics("我想开发一个宠物饮水机"), extractTopics("我想开发一个宠物饮水机"));
  assert.equal(topicOverlap(["宠物", "饮水"], ["饮水", "市场"]), 0.5);
  assert.equal(topicOverlap([], ["a"]), 0);
});

test("KX-74 selection: corrections always ride along (topic-matched first, capped), topics boost recall", () => {
  const d = (i: number) => new Date(2026, 8, i + 1);
  const items = [
    { id: "p", kind: "PREFERENCE", content: "预算上限 5 万", pinned: false, createdAt: d(0) },
    { id: "c1", kind: "CORRECTION", content: "做「宠物饮水机」这类工作时：要给价格区间", pinned: false, createdAt: d(1), topics: ["宠物", "饮水"] },
    { id: "c2", kind: "CORRECTION", content: "做「咖啡器具」这类工作时：别用英文", pinned: false, createdAt: d(2), topics: ["咖啡", "器具"] },
    { id: "c3", kind: "CORRECTION", content: "做「周报」这类工作时：先写结论", pinned: false, createdAt: d(3), topics: ["周报"] },
    { id: "c4", kind: "CORRECTION", content: "做「纪要」这类工作时：列行动项", pinned: false, createdAt: d(4), topics: ["纪要"] },
    // 文字不重叠，但主题词重叠 → 靠 topics 召回
    { id: "o1", kind: "OUTCOME", content: "上次的结论：东南亚渠道成本偏高", pinned: false, createdAt: d(5), topics: ["宠物", "饮水", "东南亚"] },
    { id: "o2", kind: "OUTCOME", content: "「咖啡器具」的结论：做便携套装", pinned: false, createdAt: d(5), topics: ["咖啡", "器具"] },
  ];
  const chosen = selectMemories(items, "再评估一下宠物饮水机");
  const ids = chosen.map((m) => m.id);
  assert.equal(ids[0], "p");
  assert.equal(ids[1], "c1", "topic-matched correction comes first: " + ids.join(","));
  assert.equal(ids.filter((i) => i.startsWith("c")).length, MAX_CORRECTIONS_INJECTED);
  assert.ok(ids.includes("o1"), "outcome recalled via topics: " + ids.join(","));
  assert.ok(!ids.includes("o2"));
  assert.match(renderMemoryPrompt(chosen), /\[纠正\] 做「宠物饮水机」/);
});

