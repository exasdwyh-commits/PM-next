import { test } from "node:test";
import assert from "node:assert/strict";
import { perspectiveStorageKey, readPerspective, projectTaskSnapshot } from "../src/modules/workspace/perspective";
test("工作视角按组织和账号隔离，损坏存储使用默认视角", () => {
  assert.notEqual(perspectiveStorageKey("org", "a"), perspectiveStorageKey("org", "b"));
  assert.notEqual(perspectiveStorageKey("org", "a"), perspectiveStorageKey("other", "a"));
  assert.notEqual(perspectiveStorageKey("a:b", "c"), perspectiveStorageKey("a", "b:c"));
  for (const value of [null, "", "admin", {}, "LEADERSHIP"]) assert.equal(readPerspective(value), "leadership");
});
test("已提交与执行中不算验收，前置依赖只在验收后解除", () => {
  const tasks = [
    { id: "a", title: "报价", status: "SUBMITTED" },
    { id: "b", title: "生产", status: "TODO", dependencies: ["a"] },
    { id: "c", title: "运输", status: "RUNNING" },
  ];
  const snapshot = projectTaskSnapshot(tasks);
  assert.equal(snapshot.accepted, 0);
  assert.equal(snapshot.blocked, 1);
  assert.equal(snapshot.running, 1);
  assert.equal(projectTaskSnapshot([{ ...tasks[0], status: "ACCEPTED" }, ...tasks.slice(1)]).blocked, 0);
});
test("缺失、损坏和自依赖不能被显示为可执行", () => {
  const snapshot = projectTaskSnapshot([
    { id: "a", title: "a", status: "TODO", dependencies: ["missing"] },
    { id: "b", title: "b", status: "TODO", dependencies: "a" },
    { id: "c", title: "c", status: "TODO", dependencies: [3] },
    { id: "d", title: "d", status: "TODO", dependencies: ["d"] },
  ]);
  assert.equal(snapshot.blocked, 4);
  assert.equal(snapshot.rows[0].missing.length, 1);
  assert.equal(snapshot.rows[1].invalidDependencies, true);
  assert.deepEqual(projectTaskSnapshot([]), { rows: [], total: 0, accepted: 0, running: 0, blocked: 0 });
});
