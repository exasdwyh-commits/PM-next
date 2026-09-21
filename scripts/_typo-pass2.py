#!/usr/bin/env python3
"""
过程脚本（不提交）：globals.css 字号整体再上一档（pass2）。
严格降序映射，避免连锁改写（新生成的值不会被后续规则再次命中）。
仅处理 1..BOUNDARY 行；之后是并行方的 .hermes-challenge-* 区域。
用法：python3 scripts/_typo-pass2.py [--apply]
"""
import re
import sys
import hashlib

PATH = "src/app/globals.css"
BOUNDARY = 586

# 必须严格降序
FS_MAP = [
    ("14.5", "15"),
    ("14",   "14.5"),
    ("13",   "14"),
    ("12",   "13"),
    ("11",   "12"),
]

apply = "--apply" in sys.argv
lines = open(PATH, encoding="utf-8").read().split("\n")
head, tail = lines[:BOUNDARY], lines[BOUNDARY:]
tail_before = hashlib.sha256("\n".join(tail).encode()).hexdigest()

report = []
for i, ln in enumerate(head):
    for old, new in FS_MAP:
        ln, n = re.subn(r"font-size:\s*%spx(?!\d)" % re.escape(old), "font-size:%spx" % new, ln)
        if n:
            report.append("L%-4d %s->%s x%d" % (i + 1, old, new, n))
    head[i] = ln

out = "\n".join(head + tail)
out_lines = out.split("\n")
tail_after = hashlib.sha256("\n".join(out_lines[BOUNDARY:]).encode()).hexdigest()

print("=== pass2 改动 %d 处 ===" % len(report))
for r in report[:60]:
    print(" ", r)
if len(report) > 60:
    print("  ... 其余 %d 处" % (len(report) - 60))

assert tail_before == tail_after, "!! challenge 区域被改动"
print("\n[断言1] challenge 区域字节不变 OK")

leftover = [
    (i + 1, m.group(0))
    for i, l in enumerate(out_lines[:BOUNDARY])
    for m in [re.search(r"font-size:\s*([0-9.]+)px", l)]
    if m and float(m.group(1)) < 12
]
assert not leftover, "!! 仍有 <12px 残留: %s" % leftover
print("[断言2] 无 <12px 残留 OK")

if apply:
    open(PATH, "w", encoding="utf-8").write(out)
    print("\n已写入")
else:
    print("\n(dry-run)")
