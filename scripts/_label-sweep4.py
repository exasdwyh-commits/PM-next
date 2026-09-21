#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
第四轮：把散落在 8 个文件里的本地「枚举中文标签表」统一到 src/shared/status-labels.ts。

设计要点（前几轮踩过的坑）：
  1. 两阶段：先对**原始文本**校验每一条操作都能命中，再统一写盘。
     否则中途失配会留下"改了一半"的文件（上一轮实际发生过）。
  2. 用正则整段替换 `XXX[expr] ?? expr` 这类取值表达式，而不是逐条字面量替换
     ——同一个表达式在文件里可能出现多次（product-overview 里 DIMENSION_LABELS 出现 6 次）。
  3. 收尾断言用 `\bNAME\b` 校验残留为 0。注意 `LAUNCH_MILESTONE_KIND_LABELS` 里的
     "KIND_LABELS" 前面是下划线（词字符），`\b` 不会误判，故该断言可靠。
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------- 操作定义
# ("drop", 常量名)                删除该常量定义块（单行或 `};` 收尾的多行）
# ("re", 正则, 替换, 期望次数)     正则替换
# ("lit", 原文, 替换, 期望次数)    字面量替换
# ("after", 锚点行, 插入文本)      在某行之后插入

S = "@/shared/status-labels"

PLAN = {
    "src/modules/workspace/overview.ts": [
        ("after", 'import { SessionContext } from "../identity/session";',
         f'\nimport {{ labelProductLifecycleStage }} from "{S}";'),
        ("drop", "LIFECYCLE_LABELS"),
        ("lit", "label: LIFECYCLE_LABELS[stage],", "label: labelProductLifecycleStage(stage),", 1),
        ("re", r"\$\{LIFECYCLE_LABELS\[([^\]]+)\] \?\? [^}]+\}",
         r"${labelProductLifecycleStage(\1)}", 1),
    ],
    "src/modules/workspace/briefing.ts": [
        ("after", 'import { fmtDate } from "@/shared/datetime";',
         f'\nimport {{ labelProductLifecycleStage, labelScoreDimension }} from "{S}";'),
        ("drop", "STAGE_LABELS"),
        ("drop", "DIM_LABELS"),
        ("re", r"\$\{DIM_LABELS\[([^\]]+)\] \?\? [^}]+\}",
         r"${labelScoreDimension(\1)}", 1),
        ("re", r"\(STAGE_LABELS\[([^\]]+)\] \?\? [^)]+\)",
         r"labelProductLifecycleStage(\1)", 1),
    ],
    "src/app/products/products-client.tsx": [
        ("after", 'import { fmtDate } from "@/shared/datetime";',
         f'\nimport {{ labelProductLifecycleStage }} from "{S}";'),
        ("drop", "LIFECYCLE_LABELS"),
        ("lit", "const stageLabel = (s: string) => LIFECYCLE_LABELS[s] ?? s;",
         "const stageLabel = (s: string) => labelProductLifecycleStage(s);", 1),
    ],
    "src/app/products/[id]/product-overview-client.tsx": [
        ("lit", "} from \"@/shared/status-labels\";",
         '  PRODUCT_SPEC_FIELD_LABELS,\n  labelProductLifecycleStage,\n  labelScoreDimension,\n} from "@/shared/status-labels";', 1),
        # 先删掉那句"与 revision.ts 保持一致"的同步注释 —— 统一后不再需要手工同步
        ("lit", "/** 与 src/modules/product-development/revision.ts 的 FIELD_LABELS 保持一致 */\n", "", 1),
        ("drop", "LIFECYCLE_LABELS"),
        ("drop", "DIMENSION_LABELS"),
        ("drop", "FIELD_LABELS"),
        ("re", r"DIMENSION_LABELS\[([^\]]+)\] \?\? [^,}\)\n]+", r"labelScoreDimension(\1)", 5),
        # 这一处取值没有 `?? 兜底`（直接取映射值），上面的正则抓不到，单列一条
        ("lit", "${DIMENSION_LABELS[unknownDims[0].dimension]}",
         "${labelScoreDimension(unknownDims[0].dimension)}", 1),
        ("re", r"LIFECYCLE_LABELS\[([^\]]+)\] \?\? [^,}\)\n]+",
         r"labelProductLifecycleStage(\1)", 1),
        ("lit", "FIELD_LABELS[f] ?? f", "PRODUCT_SPEC_FIELD_LABELS[f] ?? f", 1),
    ],
    "src/app/products/[id]/launch-tab.tsx": [
        ("lit", 'import { labelLaunchMilestoneStatus } from "@/shared/status-labels";',
         f'import {{ LAUNCH_MILESTONE_KIND_LABELS, LAUNCH_MILESTONE_STATUS_LABELS, '
         f'labelLaunchMilestoneKind, labelLaunchMilestoneStatus, labelProductLifecycleStage }} from "{S}";', 1),
        ("drop", "KIND_LABELS"),
        ("drop", "STATUS_LABELS"),
        ("drop", "LIFECYCLE_LABELS"),
        ("lit", "Object.entries(KIND_LABELS)", "Object.entries(LAUNCH_MILESTONE_KIND_LABELS)", 2),
        ("lit", "KIND_LABELS[m.kind] ?? m.kind", "labelLaunchMilestoneKind(m.kind)", 1),
        ("lit", "Object.entries(STATUS_LABELS)", "Object.entries(LAUNCH_MILESTONE_STATUS_LABELS)", 1),
        # 这处后面跟的是对象字面量的 `}`，用 `[^,]+` 会把 `}` 一并吃掉导致语法错误，
        # 故改用整段字面量替换（该串在文件里唯一）
        ("lit",
         'LIFECYCLE_LABELS[ctx?.product?.lifecycleStage] ?? ctx?.product?.lifecycleStage ?? "—"',
         "labelProductLifecycleStage(ctx?.product?.lifecycleStage)", 1),
    ],
    "src/app/war-room/war-room-client.tsx": [
        ("lit", 'import { labelEvidenceNature } from "@/shared/status-labels";',
         f'import {{ labelEvidenceNature, labelProjectStage }} from "{S}";', 1),
        ("drop", "stageLabels"),
        ("lit", "{stageLabels[p.stage] || p.stage}", "{labelProjectStage(p.stage)}", 1),
    ],
    "src/app/dashboard/dashboard-client.tsx": [
        ("after", 'import { Panel, StatGrid, Stat, Badge, Empty, PageHeading } from "@/components/ui";',
         f'\nimport {{ labelEvidenceNature, labelEvidenceVerifyStatus, labelProjectStage, '
         f'labelValidationStatus }} from "{S}";'),
        ("drop", "STAGE_LABELS"),
        ("drop", "VERIFY_LABELS"),
        ("drop", "NATURE_LABELS"),
        ("drop", "VALIDATION_LABELS"),
        ("lit", "{VERIFY_LABELS.VERIFIED}", '{labelEvidenceVerifyStatus("VERIFIED")}', 1),
        ("lit", "{VERIFY_LABELS.UNVERIFIED}", '{labelEvidenceVerifyStatus("UNVERIFIED")}', 1),
        ("lit", "{VERIFY_LABELS.REJECTED}", '{labelEvidenceVerifyStatus("REJECTED")}', 1),
        ("lit", "{NATURE_LABELS.REAL}", '{labelEvidenceNature("REAL")}', 1),
        ("lit", "{NATURE_LABELS.DEMO}", '{labelEvidenceNature("DEMO")}', 1),
        ("lit", "{VALIDATION_LABELS.UNAPPLIED}", '{labelValidationStatus("UNAPPLIED")}', 1),
        ("lit", "{VALIDATION_LABELS.IN_PROGRESS}", '{labelValidationStatus("IN_PROGRESS")}', 1),
        ("lit", "{VALIDATION_LABELS.VERIFIED_BY_LEAD}", '{labelValidationStatus("VERIFIED_BY_LEAD")}', 1),
        ("lit", "{STAGE_LABELS[k] || k}", "{labelProjectStage(k)}", 1),
        ("lit", "{STAGE_LABELS[p.stage] || p.stage}", "{labelProjectStage(p.stage)}", 1),
    ],
    # revision-panel 里的 DIMENSION_LABELS 是死代码：维度名由接口返回的 label 提供
    "src/app/products/[id]/revision-panel.tsx": [
        ("drop", "DIMENSION_LABELS"),
    ],
    # 服务端模块：唯一来源移到 shared，此处改为引用（自己保留 Record<ProductSpecField> 类型）
    "src/modules/product-development/revision.ts": [
        ("after", 'import { ConflictError, NotFoundError, UnprocessableEntityError } from "@/shared/errors";',
         f'\nimport {{ PRODUCT_SPEC_FIELD_LABELS }} from "{S}";'),
        ("re", r"export const FIELD_LABELS: Record<ProductSpecField, string> = \{[^}]*\};",
         "export const FIELD_LABELS: Record<ProductSpecField, string> = PRODUCT_SPEC_FIELD_LABELS;", 1),
    ],
}

# 改写后这些标识符必须彻底消失（\b 词边界，不会误伤 LAUNCH_MILESTONE_XXX_LABELS）
MUST_VANISH = {
    "src/modules/workspace/overview.ts": ["LIFECYCLE_LABELS"],
    "src/modules/workspace/briefing.ts": ["STAGE_LABELS", "DIM_LABELS"],
    "src/app/products/products-client.tsx": ["LIFECYCLE_LABELS"],
    "src/app/products/[id]/product-overview-client.tsx": ["LIFECYCLE_LABELS", "DIMENSION_LABELS", "FIELD_LABELS"],
    "src/app/products/[id]/launch-tab.tsx": ["KIND_LABELS", "STATUS_LABELS", "LIFECYCLE_LABELS"],
    "src/app/war-room/war-room-client.tsx": ["stageLabels"],
    "src/app/dashboard/dashboard-client.tsx": ["STAGE_LABELS", "VERIFY_LABELS", "NATURE_LABELS", "VALIDATION_LABELS"],
    "src/app/products/[id]/revision-panel.tsx": ["DIMENSION_LABELS"],
}

BLOCK_MULTI = re.compile(r"^const {name}\b[^\n]*\n(?:[^\n]*\n)*?^\}};\n", re.M)
BLOCK_ONE = re.compile(r"^const {name}\b[^\n]*\}};[ \t]*\n", re.M)


def drop_block(text: str, name: str) -> tuple[str, bool]:
    for pat in (
        BLOCK_ONE.pattern.format(name=re.escape(name)),
        BLOCK_MULTI.pattern.format(name=re.escape(name)),
    ):
        rx = re.compile(pat, re.M)
        m = rx.search(text)
        if m:
            return text[: m.start()] + text[m.end():], True
    return text, False


def main() -> int:
    originals: dict[str, str] = {}
    problems: list[str] = []

    # ---------------- 阶段 1：全量校验（不写盘）
    for rel, ops in PLAN.items():
        f = ROOT / rel
        if not f.exists():
            problems.append(f"{rel}: 文件不存在")
            continue
        text = f.read_text(encoding="utf-8")
        originals[rel] = text
        probe = text
        for op in ops:
            kind = op[0]
            if kind == "drop":
                probe, ok = drop_block(probe, op[1])
                if not ok:
                    problems.append(f"{rel}: 未找到常量定义 const {op[1]}")
            elif kind == "lit":
                _, old, _, want = op
                got = probe.count(old)
                if got != want:
                    problems.append(f"{rel}: 字面量命中 {got} 次，期望 {want} —— {old[:70]!r}")
                probe = probe.replace(old, op[2])
            elif kind == "re":
                _, pat, rep, want = op
                probe, got = re.subn(pat, rep, probe)
                if got != want:
                    problems.append(f"{rel}: 正则命中 {got} 次，期望 {want} —— {pat[:70]}")
            elif kind == "after":
                _, anchor, add = op
                if anchor not in probe:
                    problems.append(f"{rel}: 锚点行未找到 —— {anchor[:70]!r}")
                else:
                    probe = probe.replace(anchor, anchor + add, 1)

    if problems:
        print("✗ 阶段 1 校验失败，未做任何写入：\n")
        for p in problems:
            print("  -", p)
        return 1

    # 残留断言也放在写盘前（用阶段 1 的最终 probe 仅为其预测，真正断言在阶段 2 后）
    print(f"✓ 阶段 1 通过：{len(PLAN)} 个文件、"
          f"{sum(len(v) for v in PLAN.values())} 条操作全部可命中")

    # ---------------- 阶段 2：写盘
    for rel, ops in PLAN.items():
        text = originals[rel]
        for op in ops:
            kind = op[0]
            if kind == "drop":
                text, ok = drop_block(text, op[1])
                assert ok, f"{rel}: {op[1]}"
            elif kind == "lit":
                text = text.replace(op[1], op[2])
            elif kind == "re":
                text, _ = re.subn(op[1], op[2], text)
            elif kind == "after":
                text = text.replace(op[1], op[1] + op[2], 1)
        # 收尾：压掉删除块留下的多余空行
        text = re.sub(r"\n{3,}", "\n\n", text)
        (ROOT / rel).write_text(text, encoding="utf-8")

    # ---------------- 阶段 3：残留断言
    leftovers: list[str] = []
    for rel, names in MUST_VANISH.items():
        text = (ROOT / rel).read_text(encoding="utf-8")
        for n in names:
            hits = re.findall(r"\b" + re.escape(n) + r"\b", text)
            if hits:
                leftovers.append(f"{rel}: 仍残留 {n} × {len(hits)}")
    if leftovers:
        print("✗ 阶段 3 残留断言失败：\n")
        for p in leftovers:
            print("  -", p)
        return 1

    print("✓ 阶段 2 写盘完成，阶段 3 残留断言通过（旧标识符已全部消除）")
    print("\n改动文件：")
    for rel in PLAN:
        print(f"  {rel}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
