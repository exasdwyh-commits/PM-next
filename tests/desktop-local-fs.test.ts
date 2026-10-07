/**
 * 本机覆盖保护：真实文件系统（临时目录）上验证「目标已存在 → 不动任何内容、停下等人」，
 * 以及回执里给用户的确认指令能被解析器原样解析回带 overwrite/append 的动作。
 */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { moveEntry, writeTextFile } from "../src/modules/desktop-runtime/local-fs";
import {
  describeDesktopAction,
  desktopOutcomeFor,
  overwriteConfirmationResult,
  parseDesktopInstruction,
} from "../src/modules/desktop-runtime/contracts";

async function sandbox() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kern-desktop-fs-"));
  return {
    dir,
    p: (name: string) => path.join(dir, name),
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

test("LF1 新文件：直接写入", async () => {
  const s = await sandbox();
  try {
    const r = await writeTextFile(s.p("sub/new.md"), "hello");
    assert.equal(r.status, "WRITTEN");
    assert.equal(await fs.readFile(s.p("sub/new.md"), "utf8"), "hello");
  } finally {
    await s.cleanup();
  }
});

test("LF2 已存在：不覆盖、原内容不变，并报告现有文件信息", async () => {
  const s = await sandbox();
  try {
    await fs.writeFile(s.p("a.md"), "ORIGINAL");
    const r = await writeTextFile(s.p("a.md"), "new content");
    assert.equal(r.status, "EXISTS");
    if (r.status === "EXISTS") {
      assert.equal(r.existing.kind, "file");
      assert.equal(r.existing.size, "ORIGINAL".length);
      assert.equal(r.existing.path, s.p("a.md"));
    }
    assert.equal(await fs.readFile(s.p("a.md"), "utf8"), "ORIGINAL");
  } finally {
    await s.cleanup();
  }
});

test("LF3 显式覆盖 / 显式追加才会动已有内容", async () => {
  const s = await sandbox();
  try {
    await fs.writeFile(s.p("a.md"), "A");
    assert.equal((await writeTextFile(s.p("a.md"), "B", { append: true })).status, "APPENDED");
    assert.equal(await fs.readFile(s.p("a.md"), "utf8"), "AB");
    assert.equal((await writeTextFile(s.p("a.md"), "C", { overwrite: true })).status, "OVERWRITTEN");
    assert.equal(await fs.readFile(s.p("a.md"), "utf8"), "C");
    assert.equal((await writeTextFile(s.p("fresh.md"), "D", { overwrite: true })).status, "WRITTEN");
  } finally {
    await s.cleanup();
  }
});

test("LF4 移动：目标不存在直接移动；目标已存在则两边都不动", async () => {
  const s = await sandbox();
  try {
    await fs.writeFile(s.p("from.txt"), "FROM");
    assert.equal((await moveEntry(s.p("from.txt"), s.p("dir/to.txt"))).status, "MOVED");
    assert.equal(await fs.readFile(s.p("dir/to.txt"), "utf8"), "FROM");

    await fs.writeFile(s.p("other.txt"), "OTHER");
    const r = await moveEntry(s.p("other.txt"), s.p("dir/to.txt"));
    assert.equal(r.status, "EXISTS");
    assert.equal(await fs.readFile(s.p("other.txt"), "utf8"), "OTHER");
    assert.equal(await fs.readFile(s.p("dir/to.txt"), "utf8"), "FROM");

    assert.equal((await moveEntry(s.p("other.txt"), s.p("dir/to.txt"), { overwrite: true })).status, "OVERWRITTEN");
    assert.equal(await fs.readFile(s.p("dir/to.txt"), "utf8"), "OTHER");
    await assert.rejects(fs.access(s.p("other.txt")));
  } finally {
    await s.cleanup();
  }
});

test("LF5 移到自身（同一条目）不算覆盖", async () => {
  const s = await sandbox();
  try {
    await fs.writeFile(s.p("same.txt"), "X");
    assert.equal((await moveEntry(s.p("same.txt"), s.p("same.txt"))).status, "MOVED");
    assert.equal(await fs.readFile(s.p("same.txt"), "utf8"), "X");
  } finally {
    await s.cleanup();
  }
});

test("LF6 解析器：覆盖 / 追加 / 移动 都能显式表达，普通写入形状不变", () => {
  assert.deepEqual(parseDesktopInstruction("写入 ~/notes/a.md 你好"), {
    tool: "fs.write_text",
    path: "~/notes/a.md",
    content: "你好",
  });
  assert.deepEqual(parseDesktopInstruction("覆盖写入 ~/notes/a.md 新内容"), {
    tool: "fs.write_text",
    path: "~/notes/a.md",
    content: "新内容",
    overwrite: true,
  });
  assert.deepEqual(parseDesktopInstruction("追加到 ~/notes/a.md 再加一行"), {
    tool: "fs.write_text",
    path: "~/notes/a.md",
    content: "再加一行",
    append: true,
  });
  assert.deepEqual(parseDesktopInstruction("移动 ~/a.txt 到 ~/archive/a.txt"), {
    tool: "fs.move",
    from: "~/a.txt",
    to: "~/archive/a.txt",
  });
  assert.deepEqual(parseDesktopInstruction("覆盖移动 ~/a.txt 到 ~/archive/a.txt"), {
    tool: "fs.move",
    from: "~/a.txt",
    to: "~/archive/a.txt",
    overwrite: true,
  });
  assert.equal(describeDesktopAction({ tool: "fs.write_text", path: "a", content: "x", overwrite: true }).kind, "覆盖写入文件");
  assert.equal(describeDesktopAction({ tool: "fs.move", from: "a", to: "b", overwrite: true }).kind, "覆盖移动文件");
});

test("LF7 等人回执：WAITING_HUMAN，且给出的确认指令能原样解析回显式动作", () => {
  const existing = { path: "/Users/me/notes/a.md", kind: "file" as const, size: 2048, modifiedAt: "2026-09-28T01:02:03.000Z" };

  const write = overwriteConfirmationResult({ tool: "fs.write_text", path: "~/notes/a.md", content: "x" }, existing);
  assert.equal(write.ok, false);
  assert.equal(write.needsHuman, true);
  assert.equal(desktopOutcomeFor(write), "WAITING_HUMAN");
  assert.match(write.summary, /已存在/);
  assert.match(write.output ?? "", /2\.0 KB/);
  const overwriteLine = (write.output ?? "").split("\n").find((l) => l.includes("覆盖写入"));
  const appendLine = (write.output ?? "").split("\n").find((l) => l.includes("追加到"));
  assert.ok(overwriteLine && appendLine);
  const cmd = (line: string) => line.slice(line.indexOf("：") + 1).replace("<内容>", "hello");
  assert.deepEqual(parseDesktopInstruction(cmd(overwriteLine)), {
    tool: "fs.write_text", path: "~/notes/a.md", content: "hello", overwrite: true,
  });
  assert.deepEqual(parseDesktopInstruction(cmd(appendLine)), {
    tool: "fs.write_text", path: "~/notes/a.md", content: "hello", append: true,
  });

  const move = overwriteConfirmationResult({ tool: "fs.move", from: "~/a.txt", to: "~/b.txt" }, existing);
  assert.equal(desktopOutcomeFor(move), "WAITING_HUMAN");
  const moveLine = (move.output ?? "").split("\n").find((l) => l.includes("覆盖移动"));
  assert.ok(moveLine);
  assert.deepEqual(parseDesktopInstruction(cmd(moveLine)), {
    tool: "fs.move", from: "~/a.txt", to: "~/b.txt", overwrite: true,
  });
});

test("LF8 结果判定：成功 / 显式等人 / 旧文案兼容 / 普通失败", () => {
  assert.equal(desktopOutcomeFor({ ok: true, summary: "done" }), "SUCCEEDED");
  assert.equal(desktopOutcomeFor({ ok: false, needsHuman: true, summary: "x" }), "WAITING_HUMAN");
  assert.equal(desktopOutcomeFor({ ok: false, summary: "AppleScript 自动化默认关闭。" }), "WAITING_HUMAN");
  assert.equal(desktopOutcomeFor({ ok: false, summary: "ENOENT: no such file" }), "FAILED");
});
