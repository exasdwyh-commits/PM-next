#!/usr/bin/env python3
"""
第二轮：修掉回归锁守卫 4 新抓出的渲染点（走查未覆盖到的页面）。
两阶段执行：全部命中校验通过才写盘。
"""
import sys, pathlib

ROOT = pathlib.Path("/Users/exasdwyh/Documents/VScode/PM-Agent/hermes-next")
IMP = 'from "@/shared/status-labels";'
OPS = []


def op(rel, old, new, expect=1):
    OPS.append((rel, old, new, expect))


# ------------------------------------------------ project-detail-client（证据区 + 任务依赖）
F = "src/app/projects/[id]/project-detail-client.tsx"
op(
    F,
    "  labelWorkItemStatus,\n  labelAgentRunStatus,\n} " + IMP,
    "  labelWorkItemStatus,\n  labelAgentRunStatus,\n  labelEvidenceNature,\n"
    "  labelEvidenceVerifyStatus,\n  labelEvidenceClaimKind,\n} " + IMP,
)
op(
    F,
    '<Badge tone={evi.nature === "REAL" ? "ok" : "warn"}>{evi.nature}</Badge>',
    '<Badge tone={evi.nature === "REAL" ? "ok" : "warn"}>{labelEvidenceNature(evi.nature)}</Badge>',
)
op(
    F,
    "<Badge status={evi.verifyStatus} />",
    "<Badge status={evi.verifyStatus}>{labelEvidenceVerifyStatus(evi.verifyStatus)}</Badge>",
)
op(
    F,
    '<Badge tone={cl.kind === "FACT" ? "ok" : cl.kind === "INFERENCE" ? "info" : "neutral"}>{cl.kind}</Badge>',
    '<Badge tone={cl.kind === "FACT" ? "ok" : cl.kind === "INFERENCE" ? "info" : "neutral"}>'
    "{labelEvidenceClaimKind(cl.kind)}</Badge>",
)
op(
    F,
    '                        <span className="hermes-row-meta" style={{ marginLeft: "auto" }}>\n'
    "                          {pwi.status}\n"
    "                        </span>",
    '                        <span className="hermes-row-meta" style={{ marginLeft: "auto" }}>\n'
    "                          {labelWorkItemStatus(pwi.status)}\n"
    "                        </span>",
)

# ------------------------------------------------ product-overview-client（最近变更的 action）
P = "src/app/products/[id]/product-overview-client.tsx"
op(
    P,
    "import { labelProjectStage, labelEvidenceVerifyStatus, labelValidationStatus } " + IMP,
    "import {\n  labelProjectStage,\n  labelEvidenceVerifyStatus,\n  labelValidationStatus,\n"
    "  labelAuditAction,\n} " + IMP,
)
op(
    P,
    '<span className="hermes-row-title">{e.action}</span>',
    '<span className="hermes-row-title">{labelAuditAction(e.action)}</span>',
)

# ------------------------------------------------ war-room-client（待核实证据的 nature）
W = "src/app/war-room/war-room-client.tsx"
op(
    W,
    'import { identityHeaders } from "@/shared/client-identity";',
    'import { identityHeaders } from "@/shared/client-identity";\n'
    "import { labelEvidenceNature } " + IMP,
)
op(
    W,
    '<Badge tone={e.nature === "REAL" ? "ok" : "warn"}>{e.nature}</Badge>',
    '<Badge tone={e.nature === "REAL" ? "ok" : "warn"}>{labelEvidenceNature(e.nature)}</Badge>',
)

# ------------------------------------------------ 两阶段
bad = []
for rel, old, new, expect in OPS:
    p = ROOT / rel
    if not p.exists():
        bad.append(f"{rel}: 文件不存在")
        continue
    n = p.read_text(encoding="utf-8").count(old)
    if n != expect:
        bad.append(f"{rel}: 期望命中 {expect}，实际 {n} → {old[:80]!r}")

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
print(f"\n第二轮：{len(OPS)} 条替换成功，覆盖 {len(by_file)} 个文件。")
