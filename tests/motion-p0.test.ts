import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { morphDuration, toggleDetails } from "../src/components/motion/collapse";
import { reducedMotion } from "../src/components/motion/motion";
import { MOTION_BOOT_SCRIPT, MOTION_PREF_KEY } from "../src/components/motion/preference";

/** 动效 P0（KX-27）源码与原语守卫；运行时行为见 tests/ui-motion-p0.ts（Playwright）。 */

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");

function withDom<T>(opts: { reduce: boolean; motion?: string }, fn: () => T): T {
  const g = globalThis as { window?: unknown; document?: unknown };
  const saved = { window: g.window, document: g.document };
  g.window = { matchMedia: () => ({ matches: opts.reduce }) };
  g.document = { documentElement: { dataset: opts.motion ? { motion: opts.motion } : {} } };
  try {
    return fn();
  } finally {
    g.window = saved.window;
    g.document = saved.document;
  }
}

test("M27-1：高度过渡时长在 220～360ms 之间，随位移增长", () => {
  assert.equal(morphDuration(0), 220);
  assert.equal(morphDuration(100), 220);
  assert.equal(morphDuration(500), 300);
  assert.equal(morphDuration(5000), 360);
});

test("M27-2：设置页「始终播放」覆盖系统的减少动态效果；默认跟随系统", () => {
  assert.equal(withDom({ reduce: true }, reducedMotion), true);
  assert.equal(withDom({ reduce: true, motion: "full" }, reducedMotion), false);
  assert.equal(withDom({ reduce: false }, reducedMotion), false);
  assert.match(MOTION_BOOT_SCRIPT, new RegExp(`localStorage\\.getItem\\("${MOTION_PREF_KEY}"\\)==="full"`));
  assert.match(MOTION_BOOT_SCRIPT, /^try\{[\s\S]*\}catch\(e\)\{\}$/, "启动脚本不能因隐私模式等异常打断页面");
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /MOTION_BOOT_SCRIPT/);
  assert.match(layout, /suppressHydrationWarning/, "html 上的 data-motion 由启动脚本写入，需要抑制水合告警");
});

test("M27-3：减少动态效果时 <summary> 交给浏览器原生开合（不 preventDefault）", () => {
  let prevented = false;
  withDom({ reduce: true }, () => {
    const details = { tagName: "DETAILS", open: false, dataset: {}, animate() { return {}; } };
    toggleDetails({ preventDefault: () => { prevented = true; }, currentTarget: { parentElement: details } as unknown as Element });
  });
  assert.equal(prevented, false);
});

test("M27-4：所有降动画分支都允许 html[data-motion=full] 覆盖", () => {
  const files = ["src/app/globals.css", "src/app/muse/muse.css", "src/app/muse/response/response.css", "src/components/kx/kx.css"];
  const offenders: string[] = [];
  for (const f of files) {
    const css = noComments(read(f));
    for (const m of css.matchAll(/@media\s*\(prefers-reduced-motion\s*:\s*reduce\)\s*\{/g)) {
      let depth = 1;
      let i = m.index! + m[0].length;
      const start = i;
      while (depth && i < css.length) { if (css[i] === "{") depth += 1; else if (css[i] === "}") depth -= 1; i += 1; }
      for (const r of css.slice(start, i - 1).matchAll(/([^{}]+)\{/g)) {
        for (const sel of r[1].split(",").map((s) => s.trim()).filter(Boolean)) {
          if (!sel.startsWith(':root:not([data-motion="full"])')) offenders.push(`${f} → ${sel}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("M27-5：面板关闭统一走退出动画（关闭按钮 / 遮罩 / Esc），退出中不接收点击", () => {
  const sheet = read("src/app/muse/components/sheet.tsx");
  assert.match(sheet, /useExitAnimation\(onClose/);
  assert.match(sheet, /useDialog\(dialogRef, requestClose\)/, "Esc 走 requestClose");
  assert.match(sheet, /className="m-scrim"[^>]*onClick=\{requestClose\}/);
  assert.match(sheet, /aria-label="关闭"><I\.close \/><\/button>/);
  assert.doesNotMatch(sheet, /onClick=\{onClose\}/, "不能绕过退出动画直接卸载");
  const css = read("src/app/muse/muse.css");
  assert.match(css, /\.m-sheet\[data-closing\], \.m-cmd\[data-closing\] \{ pointer-events: none; \}/);
});

test("M27-9：.muse 外层用 overflow: clip，光晕外扩不会让整页被横向滚走", () => {
  const css = read("src/app/muse/muse.css");
  assert.match(css, /\.muse \{[^}]*overflow: hidden;[^}]*overflow: clip;/);
});

test("M27-6：命令面板入场保留水平居中（关键帧带 translateX(-50%)）", () => {
  const css = read("src/app/muse/muse.css");
  assert.match(css, /\.m-cmd \{[^}]*animation: m-cmd-enter /);
  assert.match(css, /@keyframes m-cmd-enter \{ from \{[^}]*translateX\(-50%\)[^}]*\} to \{[^}]*translateX\(-50%\)/);
});

test("M27-7：对话不再无条件滚到底；有「有新消息」入口；历史消息不重播入场", () => {
  const client = read("src/app/muse/muse-client.tsx");
  assert.match(client, /stickRef\.current/);
  assert.match(client, /className="m-jump"/);
  assert.match(client, /enter=\{index >= enterFrom\}/);
  assert.ok(!client.includes('tailRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });\n  }, [conversationId, messages.length, sending]);'), "旧的无条件滚动副作用已移除");
  const turn = read("src/app/muse/components/turn.tsx");
  assert.match(turn, /useEnterOnce\(ref, enter\)/);
});

test("M27-8：面板写操作的成功态只在接口返回后出现，失败保留输入", () => {
  const sheets = read("src/app/muse/components/sheets.tsx");
  assert.match(sheets, /try \{ await operation\(\); ok = true; \}/);
  assert.match(sheets, /setAction\(\{ key, state: ok \? "done" : "error" \}\)/);
  assert.match(sheets, /setDraft\(""\);\n      await load\(\);\n    \}, "add"\);/, "清空输入只发生在保存成功之后");
  assert.match(sheets, /<summary onClick=\{toggleDetails\}>/);
});
