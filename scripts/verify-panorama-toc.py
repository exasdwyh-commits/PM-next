#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""校验全景汇总 PDF 的目录页码是否与真实分页一致。

为什么需要它：HTML 里 chapter 有 `page-break-before: always`，但小节没有。
一旦某章正文长度变化，后续章节整体位移，目录里手填的页码就会说谎 ——
而这正是本文档要暴露的那类"文档与事实漂移"。

两个必须避开的坑：
  1. 目录页本身也包含全部标题文本 —— 直接全局搜"首次出现"会全部命中第 2 页。
     所以先识别目录页，并从其后开始搜索。
  2. 目录文字与正文标题可能不同（如目录写"41 个模型"、标题写"41 个 model"）。
     所以锚点必须取自正文标题，而不是目录文字。

只读，不改文件。
"""
import pathlib
import re
import sys
import unicodedata

from pypdf import PdfReader

ROOT = pathlib.Path("/Users/exasdwyh/Documents/VScode/PM-Agent/outputs")
HTML = ROOT / "HERMES产品中心-全景汇总-2026-09-15.html"

BODY_ANCHOR = "<!-- ══════════════════ 0. 用途"


def norm(s: str) -> str:
    """去空白 + 归一化汉字变体。

    该 PDF 的子集字体把不少汉字抽成部首变体（例如「页」抽成「⻚」、「无」抽成「⽆」），
    不归一化的话精确匹配全部落空，会得到"正文找不到标题"的假结论。

    两层处理，缺一不可：
      1. NFKC —— 只覆盖康熙部首（U+2F00–U+2FDF），它们有兼容映射；
      2. 手工表 —— CJK 部首补充区（U+2E80–U+2EFF）**没有** NFKC 映射，
         必须逐个映射。本 PDF 实际出现的只有下面 9 个。
    """
    s = unicodedata.normalize("NFKC", re.sub(r"\s+", "", s))
    return s.translate(RADICAL_FIX)


# CJK 部首补充区 → 对应汉字（U+2E80–U+2EFF 不在 NFKC 映射表内）
RADICAL_FIX = str.maketrans(
    {
        "⻅": "见",
        "⻆": "角",
        "⻓": "长",
        "⻔": "门",
        "⻚": "页",
        "⻛": "风",
        "⻝": "食",
        "⻩": "黄",
        "⻬": "齐",
    }
)


def parse_html(html: str):
    """返回 {编号: 正文标题文本} 与目录里登记的手填页码 {编号: 页码}。"""
    body = html[html.index(BODY_ANCHOR):]
    headings = {}
    for m in re.finditer(r"<h([23])(?:\s+class=\"sec\")?>(.*?)</h\1>", body):
        raw = re.sub(r"<[^>]+>", "", m.group(2)).strip()
        # 序号必须从**去空白之前**的文本里取。
        # 否则 "3.4 14 个页面…" 去空白后变成 "3.414个页面…"，
        # 正则会把序号读成 "3.414"，导致该条永远匹配不上。
        #
        # 两级回退：章的标题形如 "3系统形态…"（序号与文字之间没有空格），
        # 节的标题形如 "3.4 14 个页面…"（有空格）。只写一种会误伤另一种。
        num = re.match(r"^(\d+(?:\.\d+)?)(?=\s|$)", raw) or re.match(r"^(\d+)", raw)
        if num:
            headings[num.group(1)] = norm(raw)

    toc = {}
    for m in re.finditer(
        r'<li[^>]*><span class="n">([\d.]+)</span><span class="t">(.*?)</span>'
        r'<span class="d"></span><span class="p">(\d+)</span></li>',
        html,
    ):
        toc[m.group(1)] = int(m.group(3))
    return headings, toc


def page_texts(pdf: pathlib.Path):
    return [norm(p.extract_text() or "") for p in PdfReader(str(pdf)).pages]


def main() -> int:
    pdf = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "HERMES产品中心-全景汇总-2026-09-15.pdf"
    if not pdf.exists():
        print(f"找不到 PDF：{pdf}")
        return 2

    html = HTML.read_text(encoding="utf-8")
    headings, toc = parse_html(html)
    pages = page_texts(pdf)
    total = len(pages)

    # 识别目录页：包含大量目录条目标题的页；正文从其后开始
    toc_texts = [h for h in headings.values()]
    front_end = 0
    for i, txt in enumerate(pages, 1):
        hits = sum(1 for t in toc_texts if t in txt)
        if hits >= 8:
            front_end = max(front_end, i)

    print(f"PDF：{pdf.name}   总页数 {total}   目录登记 {len(toc)} 条   正文起于第 {front_end + 1} 页")
    print(f"{'条目':<6}{'目录':>5}{'实际':>6}   正文标题")
    print("-" * 70)

    bad = []
    for label in sorted(toc, key=lambda s: [int(x) for x in s.split(".")]):
        d = toc[label]
        heading = headings.get(label)
        a = None
        if heading:
            for i in range(front_end, total):  # 从前置页之后开始
                if heading in pages[i]:
                    a = i + 1
                    break
        if a != d:
            bad.append((label, d, a))
        mark = "" if a == d else "   ← 不一致"
        print(f"{label:<6}{d:>5}{str(a) if a else '—':>6}   {heading or '（正文未找到该标题）'}{mark}")

    if bad:
        print(f"\n✗ {len(bad)} 条不一致：")
        for label, d, a in bad:
            print(f"    {label}: 目录写 {d}，实际 {a if a else '未找到'}")
        return 1

    print("\n✓ 全部目录页码与真实分页一致。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
