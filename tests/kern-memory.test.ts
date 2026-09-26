import assert from "node:assert/strict";
import test from "node:test";
import { extractExplicitMemory, relevance, selectMemories, renderMemoryPrompt } from "../src/modules/memory";

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
