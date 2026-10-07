/**
 * KX-35 本机动作分级确认 — 纯函数单测（不碰 DB）。
 *  DC1 只读单条命令 AUTO；组合 / 重定向 / 写操作 CONFIRM；危险命令 DENY
 *  DC2 agent.delegate 永远 CONFIRM；非 UNBOUNDED 工具不受影响
 *  DC3 指纹稳定、对参数敏感；grant 绑定 taskRef / capability / resource
 *  DC4 「需要你」：DESKTOP_CONFIRM 为 INTERRUPT 且排在最前，并带可操作的 confirm
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyDesktopAction,
  desktopActionHash,
  desktopGrantScope,
  isReadOnlyShellCommand,
  readDesktopConfirmation,
} from "../src/modules/desktop-runtime/confirmation";
import { buildAttentionBrief } from "../src/modules/supervisor/attention";

const sh = (command: string, cwd?: string) => ({ tool: "shell.run" as const, command, cwd });

test("DC1 shell.run 三档分级", () => {
  for (const c of ["ls -la", "pwd", "git status", "git diff --stat", "git log -5"]) {
    assert.equal(classifyDesktopAction(sh(c)).policy, "AUTO", c);
  }
  for (const c of ["npm install", "git push", "git checkout -b x", "touch a.txt", "cat a | grep b", "ls > out.txt", "git status; rm a", "echo $(whoami)", "ls `pwd`", "node script.js", "cat README.md", "npm test", "npm run test:desktop-runtime", "npx tsc --noEmit", "git branch -D demo", "git diff --output=/tmp/out", "git log --output=/tmp/out", "git diff --ext-diff", "git branch new", "git status --porcelain; touch x", "cat ${TASK_SECRET}", "ls $TASK_DIR", "date -f input", "git log -5 --exec=touch"]) {
    const d = classifyDesktopAction(sh(c));
    assert.equal(d.policy, "CONFIRM", c);
    assert.ok(d.reason && d.reason.length > 0);
  }
  for (const c of ["sudo rm a", "rm -rf /", "mkfs.ext4 /dev/sda"]) {
    assert.equal(classifyDesktopAction(sh(c)).policy, "DENY", c);
  }
  assert.equal(isReadOnlyShellCommand(""), false);
  assert.equal(isReadOnlyShellCommand("lsof -i"), false, "前缀相同但不是白名单命令");
});

test("DC2 agent.delegate 始终确认；其它工具不变", () => {
  assert.equal(classifyDesktopAction({ tool: "agent.delegate", goal: "整理文档" }).policy, "CONFIRM");
  assert.equal(classifyDesktopAction({ tool: "git.status" }).policy, "AUTO");
  assert.equal(classifyDesktopAction({ tool: "fs.write_text", path: "a.md", content: "x" }).policy, "AUTO");
});

test("DC3 指纹与 grant 绑定", () => {
  assert.equal(desktopActionHash(sh("npm install", "~/p")), desktopActionHash({ cwd: "~/p", command: "npm install", tool: "shell.run" } as never));
  assert.notEqual(desktopActionHash(sh("npm install")), desktopActionHash(sh("npm install ")));
  assert.notEqual(desktopActionHash(sh("npm install", "~/a")), desktopActionHash(sh("npm install", "~/b")));
  const scope = desktopGrantScope("t1", sh("npm install", "~/p"));
  assert.deepEqual(
    { taskRef: scope.taskRef, capability: scope.capability, resource: scope.resource },
    { taskRef: "desktop:t1", capability: "shell.exec", resource: "~/p" }
  );
  assert.equal(desktopGrantScope("t2", { tool: "agent.delegate", goal: "g" }).capability, "desktop.agent.delegate");
  assert.equal(readDesktopConfirmation({}), null);
  assert.equal(readDesktopConfirmation({ desktopConfirmation: { policy: "CONFIRM", actionHash: "h" } })?.status, "PENDING");
});

test("DC4 「需要你」里确认卡优先", () => {
  const brief = buildAttentionBrief([
    { kind: "DEADLINE", id: "d", title: "里程碑", dueAt: null, blocked: true, href: "/projects", now: new Date().toISOString() },
    { kind: "DESKTOP_CONFIRM", id: "t1", label: "执行命令", detail: "npm install", reason: "可能修改文件", conversationId: "c1" },
  ]);
  assert.equal(brief.needsYou[0].id, "desktop:t1");
  assert.equal(brief.needsYou[0].level, "INTERRUPT");
  assert.deepEqual(brief.needsYou[0].confirm, { taskId: "t1", label: "执行命令", detail: "npm install", reason: "可能修改文件" });
});
