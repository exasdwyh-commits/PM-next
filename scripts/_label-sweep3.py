#!/usr/bin/env python3
"""
第三轮：把散落在 7 个文件里的本地阶段/状态标签表合并到 src/shared/status-labels.ts。

动机（不是洁癖，是真实缺陷）：
  · ProjectStage 有 2 份**完全重复**的映射（dashboard / war-room）
  · ProductLifecycleStage 有 5 份重复映射（briefing / overview / products / product-overview / launch-tab）
  · dashboard 另有 3 份与共享模块语义重叠的映射，且其中 VERIFIED_BY_LEAD 的措辞与枚举含义不符
  重复映射一旦漂移，同一枚举在不同页面显示不同中文——使用者会以为在看两件事。

两阶段执行：全部命中校验通过才写盘。
"""
import sys, pathlib

ROOT = pathlib.Path("/Users/exasdwyh/Documents/VScode/PM-Agent/hermes-next")
OPS = []


def op(rel, old, new, expect=1):
    OPS.append((rel, old, new, expect))


LC = "IDEA: \"想法入库\",\n  ANALYSIS: \"分析优化\",\n  SAMPLING: \"打样验证\",\n  LAUNCH_PREP: \"上市准备\",\n  LAUNCHED: \"已上市\",\n  REVIEW: \"复盘\",\n  PAUSED: \"暂停\",\n}"

# ------------------------------------------------ 1. modules/workspace/briefing.ts
op(
    "src/modules/workspace/briefing.ts",
    "const STAGE_LABELS: Record<string, string> = {\n  " + LC + "\n",
    "",
)
op(
    "src/modules/workspace/briefing.ts",
    "(STAGE_LABELS[p.lifecycleStage] ?? p.lifecycleStage)",
    "labelProductLifecycleStage(p.lifecycleStage)",
)
op(
    "src/modules/workspace/briefing.ts",
    "import { fmtDateTime } from \"@/shared/datetime\";",
    "import { fmtDateTime } from \"@/shared/datetime\";\n"
    "import { labelProductLifecycleStage } from \"@/shared/status-labels\";",
)

# ------------------------------------------------ 2. modules/workspace/overview.ts
op(
    "src/modules/workspace/overview.ts",
    "const LIFECYCLE_LABELS: Record<string, string> = {\n  " + LC + "\n",
    "",
)
op(
    "src/modules/workspace/overview.ts",
    "    label: LIFECYCLE_LABELS[stage],",
    "    label: labelProductLifecycleStage(stage),",
)
op(
    "src/modules/workspace/overview.ts",
    "meta: `${LIFECYCLE_LABELS[p.lifecycleStage] ?? p.lifecycleStage}",
    "meta: `${labelProductLifecycleStage(p.lifecycleStage)}",
)

# ------------------------------------------------ 3. products-client.tsx
op(
    "src/app/products/products-client.tsx",
    "const LIFECYCLE_LABELS: Record<string, string> = {\n  " + LC + "\n",
    "",
)
op(
    "src/app/products/products-client.tsx",
    "LIFECYCLE_LABELS[",
    "labelProductLifecycleStage(",
    expect=2,
)

# ------------------------------------------------ 4. product-overview-client.tsx
op(
    "src/app/products/[id]/product-overview-client.tsx",
    "const LIFECYCLE_LABELS: Record<string, string> = {\n  " + LC + "\n",
    "",
)
op(
    "src/app/products/[id]/product-overview-client.tsx",
    "{LIFECYCLE_LABELS[p.lifecycleStage] ?? p.lifecycleStage}",
    "{labelProductLifecycleStage(p.lifecycleStage)}",
)

# ------------------------------------------------ 5. launch-tab.tsx
op(
    "src/app/products/[id]/launch-tab.tsx",
    "const LIFECYCLE_LABELS: Record<string, string> = {\n  " + LC + "\n",
    "",
)

# ------------------------------------------------ 6. war-room-client.tsx
op(
    "src/app/war-room/war-room-client.tsx",
    'const stageLabels: Record<string, string> = { DRAFT: "概念定义", RESEARCH: "研究验证", '
    'SAMPLING: "配方开发", PRODUCTION_PREP: "生产准备", PRODUCTION: "商业化生产", DELIVERED: "已交付" };\n',
    "",
)
op(
    "src/app/war-room/war-room-client.tsx",
    '{stageLabels[p.stage] || p.stage}',
    "{labelProjectStage(p.stage)}",
)
op(
    "src/app/war-room/war-room-client.tsx",
    'import { labelEvidenceNature } from "@/shared/status-labels";',
    'import { labelEvidenceNature, labelProjectStage } from "@/shared/status-labels";',
)

# ------------------------------------------------ 7. dashboard-client.tsx（4 份本地表）
op(
    "src/app/dashboard/dashboard-client.tsx",
    'const STAGE_LABELS: Record<string, string> = { DRAFT: "概念定义", RESEARCH: "研究验证", '
    'SAMPLING: "配方开发", PRODUCTION_PREP: "生产准备", PRODUCTION: "商业化生产", DELIVERED: "已交付" };\n',
    "",
)
op(
    "src/app/dashboard/dashboard-client.tsx",
    'const VERIFY_LABELS: Record<string, string> = { VERIFIED: "已核实", UNVERIFIED: "未核实", REJECTED: "已驳回" };\n',
    "",
)
op(
    "src/app/dashboard/dashboard-client.tsx",
    'const NATURE_LABELS: Record<string, string> = { REAL: "真实依据", DEMO: "演示数据" };\n',
    "",
)
op(
    "src/app/dashboard/dashboard-client.tsx",
    'const VALIDATION_LABELS: Record<string, string> = { UNAPPLIED: "未应用", IN_PROGRESS: "验证中", '
    'VERIFIED_BY_LEAD: "头部客户已验证" };\n',
    "",
)
op("src/app/dashboard/dashboard-client.tsx", "STAGE_LABELS[", "labelProjectStage(", expect=2)
op("src/app/dashboard/dashboard-client.tsx", "VERIFY_LABELS[", "labelEvidenceVerifyStatus(", expect=1)
op("src/app/dashboard/dashboard-client.tsx", "NATURE_LABELS[", "labelEvidenceNature(")
op(
    "src/app/dashboard/dashboard-client.tsx",
    "{VALIDATION_LABELS.VERIFIED_BY_LEAD}",
    "{labelValidationStatus(\"VERIFIED_BY_LEAD\")}",
)
op("src/app/dashboard/dashboard-client.tsx", "VALIDATION_LABELS[", "labelValidationStatus(")

# ------------------------------------------------ 8. 下拉框里泄漏枚举名
op(
    "src/app/projects/[id]/project-detail-client.tsx",
    '<option value="VERIFIED_BY_LEAD">负责人已确认 (VERIFIED_BY_LEAD)</option>',
    '<option value="VERIFIED_BY_LEAD">负责人已确认</option>',
)

# ------------------------------------------------ 两阶段执行
bad = []
for rel, old, new, expect in OPS:
    p = ROOT / rel
    if not p.exists():
        bad.append(f"{rel}: 文件不存在")
        continue
    n = p.read_text(encoding="utf-8").count(old)
    if n != expect:
        bad.append(f"{rel}: 期望命中 {expect}，实际 {n} → {old[:70]!r}")

if bad:
    print("!! 校验未通过，磁盘零改动 !!")
    for b in bad:
        print("  ×", b)
    sys.exit(1)

by_file = {}
for rel, old, new, expect in OPS:
    by_file.setdefault(rel, []).append((old, new))
for rel, items in by_file.items():
    p = ROOT / rel
    text = p.read_text(encoding="utf-8")
    for old, new in items:
        text = text.replace(old, new)
    p.write_text(text, encoding="utf-8")
    print(f"  ✓ {rel}（{len(items)} 处）")
print(f"\n第三轮：{len(OPS)} 条替换成功，覆盖 {len(by_file)} 个文件。")
