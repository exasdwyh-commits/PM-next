/**
 * KX-23：主叙事与事件流逐一对应（纯函数断言；动效本身见 docs/mcp-frontend-motion-acceptance.md）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildStory, storyPhase, STORY_STEPS } from "../src/app/muse/mission-story";

const base = { status: "RUNNING", goal: "g", progress: { done: 0, total: 2 }, outcome: null, paused: null, contract: null, pendingAsks: [], nodes: [] as any[] };
const node = (key: string, status: string) => ({ key, kind: "RESEARCH", agentCode: "a", status, attempts: 1, taskId: null });
const ev = (seq: number, type: string, payload: Record<string, unknown> = {}) => ({ id: String(seq), seq, type, nodeKey: "n1", actorUserId: null, demo: false, createdAt: "2026-09-30T04:00:00Z", payload });

test("站点只由真实字段决定", () => {
  assert.deepEqual(STORY_STEPS.map((s) => s.key), ["think", "brief", "plan", "run", "deliver"]);
  assert.equal(storyPhase(base as any), "think");
  assert.equal(storyPhase({ ...base, contract: { criteria: [] } } as any), "brief");
  assert.equal(storyPhase({ ...base, nodes: [node("n1", "PENDING")] } as any), "plan");
  assert.equal(storyPhase({ ...base, nodes: [node("n1", "ACTIVE"), node("n2", "PENDING")] } as any), "run");
  assert.equal(storyPhase({ ...base, nodes: [node("n1", "SUCCEEDED")], outcome: { status: "COMPLETED", reasons: [] } } as any), "deliver");
});

test("停下 / 暂停 / 提问 / 取消都如实反映在动态岛与色调上", () => {
  const running = { ...base, nodes: [node("n1", "ACTIVE")] };
  assert.equal(buildStory({ ...running, outcome: { status: "NEEDS_USER", reasons: [] } } as any, []).notch.state, "warn");
  assert.equal(buildStory({ ...running, outcome: { status: "NEEDS_USER", reasons: [] } } as any, []).tone, "warn");
  assert.equal(buildStory({ ...running, paused: { at: "", byUserId: "u" } } as any, []).notch.text, "已暂停");
  assert.equal(buildStory({ ...running, pendingAsks: [{ askId: "a" }] } as any, []).notch.state, "warn");
  const cancelled = buildStory({ ...running, outcome: { status: "CANCELLED", reasons: [] } } as any, []);
  assert.equal(cancelled.tone, "bad");
  assert.equal(cancelled.notch.state, "idle");
  assert.equal(buildStory({ ...running, outcome: { status: "COMPLETED", reasons: [] } } as any, []).notch.state, "done");
});

test("假设 / 证伪 / 收回事件逐条可见，工具调用进日志，模型调用不进", () => {
  const story = buildStory({ ...base, nodes: [node("n1", "ACTIVE")] } as any, [
    ev(1, "node.hypothesis", { hypotheses: ["h"], unknowns: [] }),
    ev(2, "node.tool", { tool: "model_call", ok: true }),
    ev(3, "node.tool", { tool: "web_search", ok: true, input: "{\"q\":\"x\"}" }),
    ev(4, "node.refuted", { feedback: "数据过期" }),
    ev(5, "node.retracted"),
    ev(6, "node.tool", { tool: "web_search", ok: false }),
  ] as any);
  assert.deepEqual(story.beats.map((b) => b.kind), ["hypothesis", "refuted", "retracted"]);
  assert.equal(story.log.length, 2);
  assert.equal(story.log[1].bad, true);
  assert.ok(story.beats[1].text.includes("数据过期"));
});

test("没有事件时不编造节拍与日志", () => {
  const story = buildStory({ ...base, nodes: [node("n1", "ACTIVE")] } as any, []);
  assert.equal(story.beats.length, 0);
  assert.equal(story.log.length, 0);
});
