"""
过程脚本（不提交）：把「驾驶舱」样式块从响应式阶梯之后移到之前，并把 4 个断点
合并进既有阶梯（1280 / 1180 / 860 / 520）。

原因：globals.css 的响应式阶梯要求「全部 max-width，声明顺序必须由宽到窄」，
新块若整体追加在末尾会破坏该顺序（守卫实测变红）；而基础规则若留在阶梯之后，
又会因源码顺序压过后面的窄档覆盖。故必须「基础规则在前、断点回归阶梯」。

两阶段：先全量断言，再写盘。断言失败直接退出，不产生半成品文件。
"""

import sys

PATH = "src/app/globals.css"
lines = open(PATH, encoding="utf-8").read().split("\n")


def at(n):
    """1-indexed 取行（用于断言，行号取自编辑器读数）。"""
    return lines[n - 1]


# ---------- 阶段 1：断言定位 ----------
checks = [
    (568, "/* =========================================================================="),
    (573, "   ========================================================================== */"),
    (575, "/* —— 品牌带 —— */"),
    (648, ".hermes-feed-check { flex:0 0 auto; margin-top:2px; color:var(--ok); }"),
    (650, "@media (max-width:1280px) {"),
    (678, "}"),
    (681, "/* ========== 挑战报告卡片（Challenge Report） ========== */"),
]
for n, expect in checks:
    if at(n) != expect:
        sys.exit(f"断言失败：第 {n} 行不是预期内容\n  期望: {expect!r}\n  实际: {at(n)!r}")

if "驾驶舱（首页" not in at(569):
    sys.exit(f"断言失败：第 569 行不是驾驶舱标题\n  实际: {at(569)!r}")

# 阶梯注释所在行：驾驶舱基础规则必须插到它之前
ladder_idx = None
for i, l in enumerate(lines):
    if l.startswith("/* =====") and i + 1 < len(lines) and "响应式阶梯" in lines[i + 1]:
        ladder_idx = i
        break
if ladder_idx is None:
    sys.exit("断言失败：未找到「响应式阶梯」注释块")

header_text = lines[567:573]     # 驾驶舱区块头注释
base_text = lines[574:648]       # 驾驶舱基础规则（不含断点）
if not base_text[0].startswith("/* —— 品牌带 —— */"):
    sys.exit("断言失败：基础规则起点不是品牌带")

# ---------- 阶段 2：重建文件 ----------
REMOVE_FROM, REMOVE_TO = 565, 677  # 0-indexed：删掉旧位置的整个驾驶舱块
out = []
for i, l in enumerate(lines):
    if i == ladder_idx:
        out.extend(header_text)
        out.append("")
        out.extend(base_text)
        out.append("")
    if REMOVE_FROM <= i <= REMOVE_TO:
        continue
    out.append(l)
text = "\n".join(out)


def patch(anchor, addition, label):
    """在 anchor 前插入 addition；anchor 必须唯一，否则拒绝写盘。"""
    global text
    n = text.count(anchor)
    if n != 1:
        sys.exit(f"断言失败：{label} 锚点命中 {n} 次（期望 1）")
    text = text.replace(anchor, addition + anchor)


# 1280：紧凑笔记本，主区比例略收
patch(
    "  .hermes-topbar { padding:8px 12px 8px 16px; }\n}",
    "  .hermes-cockpit { grid-template-columns:minmax(0,1.5fr) minmax(272px,.62fr); }\n",
    "≤1280",
)

# 1180：侧栏落到主区下方 + KPI 转 3 列
patch(
    "  .hermes-content { width:calc(100% - var(--sidebar-rail)); }\n}",
    "  /* 驾驶舱：中等宽度下侧栏落到主区下方，避免右栏被压成窄条 */\n"
    "  .hermes-cockpit { grid-template-columns:minmax(0,1fr); }\n"
    "  .hermes-kpi-row { grid-template-columns:repeat(3,minmax(0,1fr)); }\n"
    "  .hermes-kpi:nth-child(3n) { border-right:0; }\n",
    "≤1180",
)

# 860：单行块，追加驾驶舱窄屏规则
patch(
    ".hermes-table { min-width:520px; } }",
    " .hermes-hero { padding:22px 18px; }"
    " .hermes-hero-quote { display:none; }"
    " .hermes-kpi-row { grid-template-columns:repeat(2,minmax(0,1fr)); }"
    " /* 先还原 3 列时的去边框规则再按 2 列重算，否则左列会误丢右边框 */"
    " .hermes-kpi:nth-child(3n) { border-right:1px solid var(--line); }"
    " .hermes-kpi:nth-child(2n) { border-right:0; }"
    " .hermes-decision-body { grid-template-columns:minmax(0,1fr); gap:8px; }"
    " .hermes-decision-num { font-size:34px; }"
    " .hermes-decision-cols { grid-template-columns:minmax(0,1fr); gap:10px; }"
    " .hermes-decision-col { padding-right:0; padding-bottom:10px; border-right:0; border-bottom:1px solid var(--line); }"
    " .hermes-decision-col:last-child { padding-bottom:0; border-bottom:0; }"
    " .hermes-cockpit-pair { grid-template-columns:minmax(0,1fr); }"
    " .hermes-stage-band { grid-template-columns:minmax(0,1fr); gap:10px; } }",
    "≤860",
)

# 520：KPI 转单列
patch(
    "  .hermes-center-card h2 { font-size:23px; }\n  .bubble-chart { height:240px; }\n}",
    "  .hermes-kpi-row { grid-template-columns:minmax(0,1fr); }\n"
    "  .hermes-kpi { border-right:0; border-bottom:1px solid var(--line); }\n"
    "  .hermes-kpi:last-child { border-bottom:0; }\n",
    "≤520",
)

# ---------- 收尾断言 ----------
import re

order = [int(m) for m in re.findall(r"@media \(max-width:(\d+)px\)", text)]
if order != sorted(order, reverse=True):
    sys.exit(f"收尾断言失败：媒体查询顺序不是由宽到窄\n  {order}")

if text.count(".hermes-kpi-row {") != 4:
    sys.exit(f"收尾断言失败：KPI 行断点未全部合入阶梯（命中 {text.count('.hermes-kpi-row {')} 次，期望 4）")

open(PATH, "w", encoding="utf-8").write(text)
print("OK · 媒体查询顺序:", order)
print("OK · 行数:", len(text.split("\n")))
