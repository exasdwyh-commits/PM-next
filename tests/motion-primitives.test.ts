import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformSync } from "esbuild";
import { MOTION, play, staggerDelays } from "../src/components/motion/motion";
import { HoldToConfirm } from "../src/components/motion/hold-to-confirm";
import { Btn, StatefulBtn } from "../src/app/muse/components/kit";
import { CopyBtn, Segmented } from "../src/app/muse/components/controls";

// tsx 以经典 JSX 运行时编译组件（tsconfig jsx: preserve），与 tests/ui-quiet-enterprise.ts 相同做法
(globalThis as { React?: typeof React }).React = React;

/** 动效原语与按钮状态（KX-11 / KX-12）。 */

const root = process.cwd();
const css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const token = (name: string) => css.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))?.[1].replace(/\s+/g, "");

type Call = { keyframes: Keyframe[]; options: KeyframeAnimationOptions; cancelled: boolean };
function fakeElement() {
  const calls: Call[] = [];
  return {
    calls,
    animate(keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      const call: Call = { keyframes, options, cancelled: false };
      calls.push(call);
      return { cancel: () => { call.cancelled = true; }, addEventListener: () => {} } as unknown as Animation;
    },
  };
}
function withReducedMotion<T>(reduce: boolean, fn: () => T): T {
  const g = globalThis as { window?: unknown };
  const saved = g.window;
  g.window = { matchMedia: () => ({ matches: reduce }) };
  try {
    return fn();
  } finally {
    g.window = saved;
  }
}

test("MP1：JS 常量与 CSS 令牌同源", () => {
  assert.equal(token("--m-d-fast"), `${MOTION.fast}ms`);
  assert.equal(token("--m-d-base"), `${MOTION.base}ms`);
  assert.equal(token("--m-d-morph"), `${MOTION.morph}ms`);
  assert.equal(token("--m-stagger"), `${MOTION.stagger}ms`);
  assert.equal(token("--m-ease-out"), MOTION.easeOut);
  assert.equal(token("--m-ease-morph"), MOTION.easeMorph);
  assert.equal(token("--m-ease-press"), MOTION.easePress);
});

test("MP2：play 时长封顶 600ms；同 key 打断旧动画；不同 key 并存", () => {
  withReducedMotion(false, () => {
    const el = fakeElement();
    play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 5000 });
    assert.equal(el.calls[0].options.duration, 600);
    play(el, [{ opacity: 1 }], {});
    assert.equal(el.calls[0].cancelled, true, "同 key 的旧动画应被打断");
    play(el, [{ transform: "none" }], { key: "other" });
    assert.equal(el.calls[1].cancelled, false, "不同 key 不互相打断");
  });
});

test("MP3：减少动态效果或无 WAAPI 时不播放", () => {
  withReducedMotion(true, () => {
    const el = fakeElement();
    assert.equal(play(el, [{ opacity: 1 }]), null);
    assert.equal(el.calls.length, 0);
  });
  withReducedMotion(false, () => {
    assert.equal(play({} as unknown as Element, [{ opacity: 1 }]), null);
    assert.equal(play(null, [{ opacity: 1 }]), null);
  });
});

test("MP4：错峰每步 45ms，最多错开 8 个", () => {
  assert.deepEqual(staggerDelays(10), [0, 45, 90, 135, 180, 225, 270, 315, 315, 315]);
});

test("MP5：原语压缩后 < 3KB（首屏预算）", () => {
  const src = fs.readFileSync(path.join(root, "src/components/motion/motion.ts"), "utf8");
  const { code } = transformSync(src, { loader: "ts", minify: true, format: "esm" });
  assert.ok(Buffer.byteLength(code) < 3072, `motion.ts 压缩后 ${Buffer.byteLength(code)}B`);
});

test("MP6：Btn 输出与改动前逐字节一致；StatefulBtn 空闲时与 Btn 相同", () => {
  assert.equal(renderToStaticMarkup(React.createElement(StatefulBtn, { state: "idle" }, "保存")), renderToStaticMarkup(React.createElement(Btn, null, "保存")));
  assert.equal(renderToStaticMarkup(React.createElement(Btn, null, "保存")), '<button type="button" class="m-btn" data-v="default">保存</button>');
  assert.equal(
    renderToStaticMarkup(React.createElement(Btn, { v: "primary", size: "sm", disabled: true, title: "t" }, "发送")),
    '<button type="button" class="m-btn" data-v="primary" data-size="sm" disabled="" title="t">发送</button>'
  );
});

test("MP7：StatefulBtn 忙碌 / 完成 / 失败有可读语义，忙碌时不可重复点击", () => {
  const busy = renderToStaticMarkup(React.createElement(StatefulBtn, { state: "busy" }, "保存"));
  assert.match(busy, /data-state="busy"/);
  assert.match(busy, /aria-busy="true"/);
  assert.match(busy, /disabled=""/);
  assert.match(busy, /处理中/);
  const done = renderToStaticMarkup(React.createElement(StatefulBtn, { state: "done" }, "保存"));
  assert.match(done, /data-state="done"/);
  assert.doesNotMatch(done, /disabled/);
  assert.match(done, /已完成/);
  const error = renderToStaticMarkup(React.createElement(StatefulBtn, { state: "error" }, "保存"));
  assert.match(error, /失败/);
  assert.match(error, /保存/, "失败时仍保留原文案，用户知道重试的是什么");
});

test("MP8：HoldToConfirm 可用键盘完成，并说明操作方式", () => {
  const html = renderToStaticMarkup(React.createElement(HoldToConfirm, { onConfirm: () => {} }, "删除"));
  assert.match(html, /aria-describedby="[^"]+"/);
  assert.match(html, /按住 0\.6 秒（键盘按住空格或回车）/);
  const src = fs.readFileSync(path.join(root, "src/components/motion/hold-to-confirm.tsx"), "utf8");
  assert.match(src, /onKeyDown=/);
  assert.match(src, /onKeyUp=/);
  assert.match(src, /k === " " \|\| k === "Enter"/);
  assert.match(src, /e\.repeat/, "长按键盘的自动重复不应重新开始计时");
  assert.match(src, /setTimeout\(/, "判定靠计时器而非动画，减少动态效果时同样可用");
});

test("MP9：Segmented 是 radiogroup，只有选中项可 Tab，支持方向键", () => {
  const html = renderToStaticMarkup(
    React.createElement(Segmented, {
      label: "展示粒度",
      value: "b",
      onChange: () => {},
      options: [{ value: "a", label: "摘要" }, { value: "b", label: "完整" }],
    }),
  );
  assert.match(html, /role="radiogroup" aria-label="展示粒度"/);
  assert.equal((html.match(/aria-checked="true"/g) ?? []).length, 1);
  assert.match(html, /aria-checked="true" tabindex="0"[^>]*>完整/);
  assert.match(html, /aria-checked="false" tabindex="-1"[^>]*>摘要/);
  const src = fs.readFileSync(path.join(process.cwd(), "src/app/muse/components/controls.tsx"), "utf8");
  assert.match(src, /ArrowRight/);
  assert.match(src, /ArrowLeft/);
});

test("MP10：CopyBtn 空闲时就是普通按钮，并有剪贴板兜底", () => {
  const html = renderToStaticMarkup(React.createElement(CopyBtn, { text: "x" }, "复制 Markdown"));
  assert.equal(html, renderToStaticMarkup(React.createElement(Btn, { size: "sm", v: "default" }, "复制 Markdown")));
  const src = fs.readFileSync(path.join(process.cwd(), "src/app/muse/components/controls.tsx"), "utf8");
  assert.match(src, /navigator\.clipboard/);
  assert.match(src, /execCommand\("copy"\)/, "非安全上下文下也能复制");
});

test("MP11：不可撤回的操作接入长按确认（取消任务、受保护动作的批准）", () => {
  const ws = fs.readFileSync(path.join(process.cwd(), "src/app/muse/components/mission-workspace.tsx"), "utf8");
  assert.match(ws, /<HoldToConfirm[^>]*hint="按住取消任务"/);
  const turn = fs.readFileSync(path.join(process.cwd(), "src/app/muse/components/turn.tsx"), "utf8");
  assert.match(turn, /d\.gate && o\.kind === "approve" \? \(\s*<HoldToConfirm/);
});
