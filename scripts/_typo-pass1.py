#!/usr/bin/env python3
"""
过程脚本（不提交）：globals.css 排版层就地改写 pass1。
- 仅处理 1..BOUNDARY 行（之后是并行方的 .hermes-challenge-* 区域，一个字节都不动）
- 字号整体上移到可读区、字重 700→600（PingFang 无 Bold，700 会合成加粗发糊）
- 非品牌处的 Georgia 换成 var(--font-title)（Georgia 无中文字形 → 中文标题落宋体）
- body 补 line-height 兜底
用法：python3 scripts/_typo-pass1.py [--apply]
"""
import re
import sys
import hashlib

PATH = "src/app/globals.css"
BOUNDARY = 586          # 1-based；587 起是 .hermes-challenge-* 区域
BRAND_LINES = {19, 20, 164, 165}   # 纯拉丁品牌标识，保留 Georgia

# 顺序重要：先小数，后整数
FS_MAP = [
    ("13.5", "14.5"),
    ("13",   "14.5"),
    ("12",   "14"),
    ("11",   "13"),
    ("10",   "12"),
    ("9",    "11"),
    ("8",    "11"),
]

apply = "--apply" in sys.argv
src = open(PATH, encoding="utf-8").read()
lines = src.split("\n")
head, tail = lines[:BOUNDARY], lines[BOUNDARY:]
tail_hash_before = hashlib.sha256("\n".join(tail).encode()).hexdigest()

report = []

for i, ln in enumerate(head):
    lineno = i + 1
    orig = ln

    # 1) 字号上移
    for old, new in FS_MAP:
        ln, n = re.subn(r"font-size:\s*%spx" % re.escape(old), "font-size:%spx" % new, ln)
        if n:
            report.append("L%-4d font-size %s->%s x%d" % (lineno, old, new, n))

    # 1b) font: 简写里的字号（正则 1 只覆盖 font-size 属性）
    ln, n = re.subn(r"font:\s*13px", "font:14.5px", ln)
    if n:
        report.append("L%-4d font shorthand 13px->14.5px x%d" % (lineno, n))

    # 2) 字重：PingFang 无 700，合成加粗会发糊
    ln, n = re.subn(r"font-weight:\s*7\d\d", "font-weight:600", ln)
    if n:
        report.append("L%-4d font-weight 7xx->600 x%d" % (lineno, n))

    # 3) Georgia -> 标题字体栈（跳过品牌行）
    if lineno not in BRAND_LINES and "Georgia" in ln:
        ln, n = re.subn(r"Georgia\s*,\s*serif", "var(--font-title)", ln)
        if n:
            report.append("L%-4d Georgia->var(--font-title) x%d" % (lineno, n))

    # 4) body 补行高兜底
    if lineno == 12 and "line-height" not in ln:
        ln = ln.replace("margin:0;", "margin:0; line-height:1.6;", 1)
        report.append("L12   body += line-height:1.6")

    head[i] = ln

out = "\n".join(head + tail)
tail_hash_after = hashlib.sha256("\n".join(out.split("\n")[BOUNDARY:]).encode()).hexdigest()

print("=== 改动明细（%d 处） ===" % len(report))
for r in report:
    print(" ", r)

# 断言 1：挑战区域必须字节不变
assert tail_hash_before == tail_hash_after, "!! 挑战区域被改动，中止"
print("\n[断言1] challenge 区域字节不变 OK")

# 断言 2：head 内不得残留 <11px 字号
leftover = [
    (i + 1, m.group(0))
    for i, l in enumerate(out.split("\n")[:BOUNDARY])
    for m in [re.search(r"font-size:\s*([0-9.]+)px", l)]
    if m and float(m.group(1)) < 11
]
assert not leftover, "!! 仍有 <11px 字号残留: %s" % leftover
print("[断言2] 无 <11px 残留 OK")

# 断言 3：非品牌处不得残留 Georgia
bad = [
    (i + 1, l.strip()[:80])
    for i, l in enumerate(out.split("\n")[:BOUNDARY])
    if "Georgia" in l and (i + 1) not in BRAND_LINES
]
assert not bad, "!! 仍有 Georgia 残留: %s" % bad
print("[断言3] 非品牌处无 Georgia 残留 OK")

if apply:
    open(PATH, "w", encoding="utf-8").write(out)
    print("\n已写入 %s" % PATH)
else:
    print("\n(dry-run，加 --apply 写入)")
