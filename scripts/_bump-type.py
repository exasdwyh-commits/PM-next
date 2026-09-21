#!/usr/bin/env python3
"""一次性脚本（下划线前缀，不提交）：按「前端界面开发专家」铁律 2 提升排版层级。

每处替换都断言「恰好命中 1 次」，任何一处未命中即整体失败（不静默跳过）。
"""
import pathlib
import sys

CSS = pathlib.Path("src/app/globals.css")

# (旧串, 新串, 说明)
EDITS = [
    # —— 页面标题：戏剧化跳跃（正文 15px → 页标题 42px ≈ 2.8×） ——
    (".hermes-page-heading h1 { font-size: 38px; }",
     ".hermes-page-heading h1 { font-size: 42px; }",
     "页标题 38→42px"),
    # —— 区块 / 卡片标题 ——
    (".hermes-panel-title { font:20px var(--font-title); color:var(--ink); margin:0; }",
     ".hermes-panel-title { font:23px/1.25 var(--font-title); color:var(--ink); margin:0; }",
     "面板标题 20→23px"),
    (".hermes-brief-section-title { font:21px/1.3 var(--font-title); color:var(--ink); margin:0; }",
     ".hermes-brief-section-title { font:23px/1.3 var(--font-title); color:var(--ink); margin:0; }",
     "简报标题 21→23px"),
    (".hermes-theme-title { font:19px/1.3 var(--font-title); color:var(--ink); margin:0; }",
     ".hermes-theme-title { font:22px/1.3 var(--font-title); color:var(--ink); margin:0; }",
     "主题标题 19→22px"),
    (".hermes-hero-mark { margin:6px 0 7px; font-family:var(--font-title); font-size:34px; line-height:1; letter-spacing:-1px; color:var(--ink); }",
     ".hermes-hero-mark { margin:6px 0 7px; font-family:var(--font-title); font-size:38px; line-height:1; letter-spacing:-.5px; color:var(--ink); }",
     "品牌带字标 34→38px"),
    (".hermes-hero-tagline { margin:0 0 8px; font-family:var(--font-title); font-size:23px; line-height:var(--lh-tight); color:var(--ink); }",
     ".hermes-hero-tagline { margin:0 0 8px; font-family:var(--font-title); font-size:24px; line-height:var(--lh-tight); color:var(--ink); }",
     "品牌带主张 23→24px"),
    # —— 正文：向专家要求的 16px 靠拢（15.5 → 16） ——
    (".hermes-theme-conclusion { margin:0; font-size:15.5px; line-height:1.7; color:var(--ink); }",
     ".hermes-theme-conclusion { margin:0; font-size:16px; line-height:1.7; color:var(--ink); }",
     "主题结论 15.5→16px"),
    (".hermes-theme-detail p { margin:0; font-size:15px; line-height:1.7; color:var(--ink-2); }",
     ".hermes-theme-detail p { margin:0; font-size:15.5px; line-height:1.7; color:var(--ink-2); }",
     "主题明细 15→15.5px"),
    (".hermes-theme-detail-p { margin:0; font-size:15px; line-height:1.7; color:var(--ink-2); }",
     ".hermes-theme-detail-p { margin:0; font-size:15.5px; line-height:1.7; color:var(--ink-2); }",
     "主题明细段 15→15.5px"),
    (".hermes-note { color:var(--ink-muted); font-size:14px; margin:0; }",
     ".hermes-note { color:var(--ink-muted); font-size:14.5px; margin:0; }",
     "注脚 14→14.5px"),
    (".hermes-panel-sub { color:var(--ink-muted); font-size:14px; margin:5px 0 0; }",
     ".hermes-panel-sub { color:var(--ink-muted); font-size:14.5px; margin:5px 0 0; }",
     "面板副题 14→14.5px"),
    (".hermes-row-title { font-size:14.5px; font-weight:600; color:var(--ink); }",
     ".hermes-row-title { font-size:15px; font-weight:600; color:var(--ink); }",
     "行标题 14.5→15px"),
    (".hermes-row-body { margin-top:7px; color:var(--ink-2); font-size:14px; line-height:1.65; }",
     ".hermes-row-body { margin-top:7px; color:var(--ink-2); font-size:15px; line-height:1.65; }",
     "行正文 14→15px"),
    (".hermes-header-secondary { color: var(--ink-faint) !important; font-size:15px !important; }",
     ".hermes-header-secondary { color: var(--ink-faint) !important; font-size:15.5px !important; }",
     "次级头部 15→15.5px"),
    # —— AI 判断卡的主结论再抬一级 ——
    (".hermes-ai-lead { margin:0; font-size:16.5px; line-height:1.7; color:var(--ink); }",
     ".hermes-ai-lead { margin:0; font-size:17.5px; line-height:1.65; color:var(--ink); }",
     "AI 主结论 16.5→17.5px"),
    # —— 主题卡片里的结论段（brief-para）——
    (".hermes-brief-para { margin: 0; font-size: 15.5px; line-height: 1.75; color: var(--ink-2); }",
     ".hermes-brief-para { margin: 0; font-size: 16px; line-height: 1.75; color: var(--ink-2); }",
     "简报段落 15.5→16px"),
]

text = CSS.read_text(encoding="utf-8")
fails = []
for old, new, label in EDITS:
    n = text.count(old)
    if n != 1:
        fails.append(f"{label}: 命中 {n} 次（期望 1）")
        continue
    text = text.replace(old, new)
    print(f"  ✔ {label}")

if fails:
    print("\n❌ 未通过的替换：")
    for f in fails:
        print("   -", f)
    sys.exit(1)

CSS.write_text(text, encoding="utf-8")
print(f"\n🏆 共 {len(EDITS)} 处替换全部命中并写入")
