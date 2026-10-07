import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAttentionFeed } from "../src/modules/muse/attention-feed";
import { buildAttentionBrief } from "../src/modules/supervisor/attention";
import { diffFeed, type FeedItem } from "../src/app/muse/desktop-notify";

const need = { id: "p1", level: "SURFACE" as const, title: "发布新品方案", why: "需要你拍板", href: null, conversationId: "c1", sortKey: 1 };

test("AF1：三类信号都进信号流，key 稳定，链接只指向站内", () => {
  const items = buildAttentionFeed(
    {
      needsYou: [need, { ...need, id: "p2", href: "https://evil.example", conversationId: null }],
      recentDone: [{ id: "m1", title: "分析燕麦脆机会", finishedAt: new Date().toISOString(), conversationId: "c9" }],
    },
    [
      { id: "s1", title: "每日简报", lastStatus: "FAILED", lastError: "Worker 未运行", lastRunAt: "2026-09-29T01:00:00.000Z" },
      { id: "s2", title: "提醒", lastStatus: "POSTED", lastError: null, lastRunAt: null },
    ]
  );
  assert.deepEqual(items.map((i) => i.key), ["n:p1", "n:p2", "d:m1", "s:s1:2026-09-29T01:00:00.000Z"]);
  assert.equal(items[0].href, "/muse?c=c1");
  assert.equal(items[1].href, "/muse", "外部链接被丢弃");
  assert.equal(items[2].kind, "done");
  assert.equal(items[3].body, "Worker 未运行");
});

test("AF2：同一定时任务再次失败（运行时间变了）算新条目", () => {
  const f = (at: string) => buildAttentionFeed({ needsYou: [], recentDone: [] }, [{ id: "s1", title: "简报", lastStatus: "FAILED", lastError: null, lastRunAt: at }]);
  assert.notEqual(f("2026-09-29T01:00:00Z")[0].key, f("2026-09-30T01:00:00Z")[0].key);
});

test("AF3：recentDone 只含 24 小时内完成的任务，completedRecently 数量保持兼容", () => {
  const base = { kind: "MISSION" as const, goal: "g", paused: false, progress: { done: 1, total: 1 }, reasons: [], conversationId: null, seenByUser: false };
  const b = buildAttentionBrief([
    { ...base, id: "new", status: "COMPLETED", finishedAt: new Date().toISOString() },
    { ...base, id: "old", status: "COMPLETED", finishedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
    { ...base, id: "run", status: "RUNNING", finishedAt: null },
  ]);
  assert.deepEqual(b.recentDone.map((d) => d.id), ["new"]);
  assert.equal(b.completedRecently, 1);
});

test("AF4：通知去重——第一轮只建基线不弹；之后只弹新出现的；消失再出现不重复弹", () => {
  const it = (key: string): FeedItem => ({ key, kind: "done", title: key, body: "", href: "/muse" });
  let r = diffFeed(null, [it("a"), it("b")]);
  assert.equal(r.fresh.length, 0);
  r = diffFeed(r.seen, [it("a"), it("b"), it("c")]);
  assert.deepEqual(r.fresh.map((x) => x.key), ["c"]);
  r = diffFeed(r.seen, [it("c")]);
  r = diffFeed(r.seen, [it("a"), it("c")]);
  assert.equal(r.fresh.length, 0);
});
