import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

/** 动效 P1（KX-28）源码守卫；运行时行为见 tests/ui-motion-p1.ts（Playwright）。 */

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const LIST = noComments(read("src/components/motion/list.ts"));
const TABS_MOTION = noComments(read("src/components/motion/tabs.ts"));
const TABS = noComments(read("src/components/tabs.tsx"));
const NOTICE = noComments(read("src/components/notice.tsx"));
const UI = read("src/components/ui.tsx");
const KX = noComments(read("src/components/kx/index.tsx"));
const KX_CSS = read("src/components/kx/kx.css");
const GLOBALS = read("src/app/globals.css");
const MUSE_CSS = read("src/app/muse/muse.css");
const SHEETS = read("src/app/muse/components/sheets.tsx");
const PDC = read("src/app/projects/[id]/project-detail-client.tsx");
const POC = read("src/app/products/[id]/product-overview-client.tsx");

test("M28-1：列表位置反馈只用 transform / opacity，按 data-key 比对，只动变化项", () => {
  assert.match(LIST, /dataset\.key/);
  assert.match(LIST, /translateY/);
  assert.doesNotMatch(LIST, /\b(height|top|left|marginTop)\s*:/, "列表动画不得动布局属性");
  assert.match(LIST, /staggerDelays/, "首屏入场复用 motion.ts 的错峰");
  assert.match(LIST, /Math\.abs\([^)]*\)\s*(<|>=?)\s*1/, "位移不足 1px 的项不动");
});

test("M28-2：骨架只在首次读取时出现，替换列表型面板的「读取中…」，并能被读屏读到", () => {
  assert.match(SHEETS, /function SheetSkeleton/);
  assert.match(SHEETS, /className="m-skel" role="status"/);
  assert.doesNotMatch(SHEETS, /items === null \? \(\s*<p className="m-quiet">读取中…<\/p>/, "列表面板不再用纯文字读取态");
  assert.match(MUSE_CSS, /\.m-skel-card span::after \{[^}]*animation: m-sweep/, "骨架光带复用已登记的 m-sweep 循环");
  assert.match(MUSE_CSS, /:root:not\(\[data-motion="full"\]\) \.m-skel-card span::after \{ animation: none/);
});

test("M28-3：记忆 / 凭证列表接入位置反馈；置顶后本地按服务端同序重排", () => {
  assert.equal((SHEETS.match(/useListFlip\(listRef\)/g) ?? []).length, 2);
  assert.equal((SHEETS.match(/<ul className="m-mem" ref=\{listRef\}>/g) ?? []).length, 2);
  assert.match(SHEETS, /<li key=\{m\.id\} data-key=\{m\.id\}/);
  assert.match(SHEETS, /\.sort\(byPinned\)/);
  assert.match(SHEETS, /Number\(b\.pinned\) - Number\(a\.pinned\) \|\| b\.createdAt\.localeCompare\(a\.createdAt\)/);
  assert.match(MUSE_CSS, /\.m-mem \{ position: relative; \}/, "列表是定位容器，offsetTop 量的是列表内位置");
});

test("M28-4：标签组件是客户端组件，带方向键与 roving tabindex，ui.tsx 只做再导出", () => {
  assert.match(read("src/components/tabs.tsx"), /^"use client";/);
  assert.match(UI, /export \{ Tabs \} from "\.\/tabs";/);
  assert.doesNotMatch(UI, /export function Tabs/);
  for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) assert.match(TABS, new RegExp(`"${key}"`));
  assert.match(TABS, /role="tablist"/);
  assert.match(TABS, /data-morph="tabs"/);
  assert.match(TABS, /tabIndex=\{[^}]*-1/);
  assert.match(TABS, /useTabInk\(/);
});

test("M28-5：底板只在量好位置后才有过渡；尺寸过渡只出现在 [data-morph] 上；无 JS 时保留原选中底色", () => {
  assert.match(TABS_MOTION, /"--ink-x"/);
  assert.match(TABS_MOTION, /"ready"/);
  assert.match(GLOBALS, /\.hermes-tabs\[data-morph\]\[data-ink="ready"\]::before, \.hermes-workspace-tabs\[data-morph\]\[data-ink="ready"\]::before \{ transition: transform var\(--m-d-base\)/);
  assert.match(GLOBALS, /\.hermes-tabs\[data-ink\] > button\.is-active \{ background: transparent;/);
  assert.doesNotMatch(GLOBALS, /\.hermes-tabs > button\.is-active \{ background: transparent/, "未量到位置（data-ink 缺省）时不能把选中底色去掉");
  assert.match(GLOBALS, /\.hermes-tabs \{ position: relative; scroll-margin-top: calc\(var\(--topbar/);
});

test("M28-6：标签内容切换：淡入 + 高度平滑 + 视野拉回标签栏下方，不用 smooth 滚动", () => {
  assert.match(TABS_MOTION, /export function useTabSwap/);
  assert.match(TABS_MOTION, /morphHeightFrom/);
  assert.match(TABS_MOTION, /opacity: 0/);
  assert.doesNotMatch(TABS_MOTION, /behavior:\s*"smooth"/);
  assert.match(PDC, /useTabInk\(workspaceTabsRef, activeWorkspaceTab\)/);
  assert.match(PDC, /useTabSwap\(workspacePanelRef, activeWorkspaceTab, workspaceTabsRef\)/);
  assert.match(PDC, /className="hermes-workspace-tabs" role="tablist" aria-label="项目工作区" data-morph="tabs"/);
  assert.match(POC, /useTabSwap\(tabPanelRef, tab, tabsRef\)/);
  assert.match(POC, /listRef=\{tabsRef\}/);
});

test("M28-7：提示：成功默认 5 秒自动淡出（悬停 / 聚焦暂停），失败常驻可关，读屏语义正确", () => {
  assert.match(NOTICE, /role=\{[^}]*"alert"[^}]*"status"[^}]*\}|"alert" : "status"/);
  assert.match(NOTICE, /aria-label="关闭提示"/);
  assert.match(NOTICE, /data-closing/);
  assert.match(NOTICE, /onMouseEnter|onPointerEnter/);
  assert.match(NOTICE, /onFocus/);
  assert.match(NOTICE, /5000/);
  assert.match(NOTICE, /tone === "ok" \|\| [a-z.]*tone === "info"|"ok" \|\| .*"info"/, "只有成功 / 信息默认自动消失");
  assert.match(GLOBALS, /\.hermes-notice\[data-closing\] \{ pointer-events: none; \}/);
  assert.match(GLOBALS, /\.hermes-notice-close \{[^}]*width: 32px; height: 32px;/);
  // 页面接入：产品总览两处、项目详情一处；项目详情自己的 5 秒计时保留，组件不再重复计时
  assert.equal((POC.match(/<Notice msg=\{msg\} onClose=\{\(\) => setMsg\(null\)\}/g) ?? []).length, 2);
  assert.doesNotMatch(POC, /className=\{cx\("hermes-banner", msg\.tone/);
  assert.match(PDC, /<Notice[\s\S]{0,200}autoHideMs=\{0\}/);
});

test("M28-8：抽屉退出：先播放再卸载，退出期间内容保持、遮罩不拦截，重开从当前位置回到打开态", () => {
  assert.match(KX, /const closing = present && !open;/);
  assert.match(KX, /lastContent/);
  assert.match(KX, /key: "drawer"/);
  assert.match(KX, /data-closing=\{closing \|\| undefined\}/);
  assert.match(KX, /useDialog\(dialogRef, onClose, open && mounted\)/, "关闭一开始就释放焦点陷阱与滚动锁");
  assert.match(KX, /getAnimations\(\)\.forEach\(\(a\) => a\.cancel\(\)\)/);
  assert.match(KX_CSS, /\.kx-drawer\[data-closing\] \{ pointer-events: none; \}/);
});

test("M28-9：P1 回归脚本已登记到 test:ui-motion，与 P0 同一次构建", () => {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  assert.match(pkg.scripts["test:ui-motion"], /tests\/ui-motion-p0\.ts tests\/ui-motion-p1\.ts/);
  assert.match(pkg.scripts["test:source-guards"], /tests\/motion-p1\.test\.ts/);
});
