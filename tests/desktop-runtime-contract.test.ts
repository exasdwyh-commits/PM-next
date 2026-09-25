import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  isDesktopInstruction,
  parseDesktopInstruction,
} from "../src/modules/desktop-runtime/contracts";

test("desktop intent only captures explicit local-computer work", () => {
  assert.equal(isDesktopInstruction("本机帮我执行 git status"), true);
  assert.equal(isDesktopInstruction("读取文件 ~/Desktop/a.txt"), true);
  assert.equal(isDesktopInstruction("帮我分析这个产品的市场机会"), false);
});

test("desktop parser compiles common Mac actions", () => {
  assert.deepEqual(parseDesktopInstruction("读取剪贴板"), {
    tool: "clipboard.read",
  });
  assert.deepEqual(
    parseDesktopInstruction("浏览器打开 https://example.com"),
    { tool: "browser.open", url: "https://example.com" }
  );
  assert.deepEqual(parseDesktopInstruction("本机执行 git status"), {
    tool: "git.status",
    cwd: undefined,
  });
  assert.deepEqual(
    parseDesktopInstruction("终端执行 npm test"),
    { tool: "shell.run", command: "npm test", cwd: undefined }
  );
});

test("unstructured but explicit desktop goals delegate to local agent", () => {
  const action = parseDesktopInstruction(
    "本机帮我整理这个代码仓库，修复测试并给我结果"
  );
  assert.equal(action?.tool, "agent.delegate");
  if (action?.tool === "agent.delegate") {
    assert.match(action.goal, /整理这个代码仓库/);
  }
});

test("desktop runtime delivery wiring stays present", () => {
  const root = process.cwd();
  const service = fs.readFileSync(
    path.join(root, "src/modules/desktop-runtime/service.ts"),
    "utf8"
  );
  const advisor = fs.readFileSync(
    path.join(root, "src/modules/advisor/service.ts"),
    "utf8"
  );
  const client = fs.readFileSync(
    path.join(root, "src/app/advisor/advisor-client.tsx"),
    "utf8"
  );
  const runtime = fs.readFileSync(
    path.join(root, "scripts/hermes-desktop.ts"),
    "utf8"
  );

  assert.ok(service.includes("desktopConversationId"));
  assert.ok(service.includes("desktopResult"));
  assert.ok(service.includes("prisma.message.create"));
  assert.ok(advisor.includes('"DESKTOP_EXECUTION"'));
  assert.ok(advisor.includes('"desktop.runtime"'));
  assert.ok(client.includes("Desktop Runtime 完成任务后会把真实结果写回原会话"));
  assert.ok(runtime.includes('"codex"'));
  assert.ok(runtime.includes('"workspace-write"'));
  assert.ok(runtime.includes("HERMES_DESKTOP_ALLOWED_ROOTS"));
});
