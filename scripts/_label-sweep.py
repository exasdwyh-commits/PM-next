#!/usr/bin/env python3
"""
把「裸枚举渲染」统一改为经 src/shared/status-labels.ts 的中文标签。

两阶段执行：先把全部替换记为待办并**逐条校验命中数**，全部通过后才写盘。
任何一条不达标 → 直接退出，磁盘零改动（避免"改了一半"的坏状态）。
"""
import sys, pathlib

ROOT = pathlib.Path("/Users/exasdwyh/Documents/VScode/PM-Agent/hermes-next")
IMP = 'from "@/shared/status-labels";'

OPS = []  # (rel, old, new, expect)


def op(rel, old, new, expect=1):
    OPS.append((rel, old, new, expect))


# ---------------------------------------------------------------- project-detail-client
F = "src/app/projects/[id]/project-detail-client.tsx"
op(
    F,
    'import { fmtDateTime, fmtTime } from "@/shared/datetime";',
    'import { fmtDateTime, fmtTime } from "@/shared/datetime";\n'
    "import {\n"
    "  labelRunMode,\n"
    "  labelOpportunityType,\n"
    "  labelOpportunityElement,\n"
    "  labelValidationStatus,\n"
    "  labelDecisionPacketStatus,\n"
    "  labelWorkItemStatus,\n"
    "  labelAgentRunStatus,\n"
    "} " + IMP,
)
op(F, "eyebrow={`模式 · ${project.mode}`}", "eyebrow={`模式 · ${labelRunMode(project.mode)}`}")
op(F, '<Badge tone="ok">{opportunity.type}</Badge>', '<Badge tone="ok">{labelOpportunityType(opportunity.type)}</Badge>')
op(
    F,
    "                        {el.key}\n                      </div>",
    "                        {labelOpportunityElement(el.key)}\n                      </div>",
)
op(F, "<strong>{v.status}</strong>", "<strong>{labelValidationStatus(v.status)}</strong>")
op(F, "<Badge tone={pktTone}>{pkt.status}</Badge>", "<Badge tone={pktTone}>{labelDecisionPacketStatus(pkt.status)}</Badge>")
op(F, "<Badge tone={wiTone}>{item.status}</Badge>", "<Badge tone={wiTone}>{labelWorkItemStatus(item.status)}</Badge>")
op(
    F,
    '<Badge tone={failed || cancelled ? "danger" : "ok"}>{r.status}</Badge>',
    '<Badge tone={failed || cancelled ? "danger" : "ok"}>{labelAgentRunStatus(r.status)}</Badge>',
)

# ---------------------------------------------------------------- settings（标签模块已导入）
S = "src/app/settings/page.tsx"
op(S, 'hint="含未接入模型时的模拟运行（TEST_STUB）"', 'hint="含未接入真实模型时的模拟运行（见下方「模型配置」）"')
op(S, '{ k: "当前 provider", v: runtime.provider || "未配置" }', '{ k: "当前模型提供方", v: runtime.provider || "未配置" }')
op(S, '{ k: "当前 modelId", v: runtime.modelId || "未配置" }', '{ k: "当前模型 ID", v: runtime.modelId || "未配置" }')
op(S, '{ k: "费用状态", v: "unknown（未接入计费口径，不编造额度）" }', '{ k: "费用状态", v: "未接入计费口径（不编造额度）" }')

# ---------------------------------------------------------------- trace-client
T = "src/app/trace/trace-client.tsx"
op(
    T,
    'import { fmtDateTimeFull } from "@/shared/datetime";',
    'import { fmtDateTimeFull } from "@/shared/datetime";\n'
    "import { labelDecisionPacketStatus, labelFeedbackStatus, labelAuditAction } " + IMP,
)
op(T, "<Badge status={pkt.status}>{pkt.status}</Badge>", "<Badge status={pkt.status}>{labelDecisionPacketStatus(pkt.status)}</Badge>")
op(
    T,
    '<Badge tone={fb.status === "ACCEPTED" ? "ok" : "danger"}>{fb.status}</Badge>',
    '<Badge tone={fb.status === "ACCEPTED" ? "ok" : "danger"}>{labelFeedbackStatus(fb.status)}</Badge>',
)
op(T, '<span className="hermes-mono">{a.action}</span>', '<span className="hermes-mono">{labelAuditAction(a.action)}</span>')

# ---------------------------------------------------------------- knowledge-client
K = "src/app/knowledge/knowledge-client.tsx"
op(
    K,
    'import { fmtDateTime } from "@/shared/datetime";',
    'import { fmtDateTime } from "@/shared/datetime";\n'
    "import { labelCompanyFactStatus, labelKnowledgeSourceKind } " + IMP,
)
op(
    K,
    '<Badge tone={f.status === "CONFIRMED" ? "ok" : "warn"}>{f.status}</Badge>',
    '<Badge tone={f.status === "CONFIRMED" ? "ok" : "warn"}>{labelCompanyFactStatus(f.status)}</Badge>',
    expect=2,
)
op(K, '<Badge tone="brand">{src.kind}</Badge>', '<Badge tone="brand">{labelKnowledgeSourceKind(src.kind)}</Badge>')

# ---------------------------------------------------------------- opportunities-client
O = "src/app/opportunities/opportunities-client.tsx"
op(
    O,
    'import { fmtDate, fmtDateTime } from "@/shared/datetime";',
    'import { fmtDate, fmtDateTime } from "@/shared/datetime";\n'
    "import { labelEvidenceVerifyStatus } " + IMP,
)
op(O, "<Badge status={s.verifyStatus} />", "<Badge status={s.verifyStatus}>{labelEvidenceVerifyStatus(s.verifyStatus)}</Badge>")

# ---------------------------------------------------------------- consultation-client
C = "src/app/consultation/consultation-client.tsx"
op(
    C,
    'import { fmtDateTimeFull } from "@/shared/datetime";',
    'import { fmtDateTimeFull } from "@/shared/datetime";\n'
    "import { labelFeedbackStatus } " + IMP,
)
op(C, "<Badge status={fb.status} />", "<Badge status={fb.status}>{labelFeedbackStatus(fb.status)}</Badge>")

# ---------------------------------------------------------------- product-overview-client
P = "src/app/products/[id]/product-overview-client.tsx"
op(
    P,
    'import { fmtDate, fmtDateTime } from "@/shared/datetime";',
    'import { fmtDate, fmtDateTime } from "@/shared/datetime";\n'
    "import { labelProjectStage, labelEvidenceVerifyStatus, labelValidationStatus } " + IMP,
)
op(P, '<Badge tone="info">{proj.stage}</Badge>', '<Badge tone="info">{labelProjectStage(proj.stage)}</Badge>')
op(P, "<Badge status={ev.verifyStatus} />", "<Badge status={ev.verifyStatus}>{labelEvidenceVerifyStatus(ev.verifyStatus)}</Badge>")
op(P, '<Badge tone="info">{ev.validationStatus}</Badge>', '<Badge tone="info">{labelValidationStatus(ev.validationStatus)}</Badge>')

# ---------------------------------------------------------------- launch-tab
L = "src/app/products/[id]/launch-tab.tsx"
op(
    L,
    'import { fmtDate, fmtDateTime } from "@/shared/datetime";',
    'import { fmtDate, fmtDateTime } from "@/shared/datetime";\n'
    "import { labelLaunchMilestoneStatus } " + IMP,
)
op(L, "<Badge status={m.status} />", "<Badge status={m.status}>{labelLaunchMilestoneStatus(m.status)}</Badge>")


# ---------------------------------------------------------------- 两阶段执行
bad = []
for rel, old, new, expect in OPS:
    p = ROOT / rel
    if not p.exists():
        bad.append(f"{rel}: 文件不存在")
        continue
    n = p.read_text(encoding="utf-8").count(old)
    if n != expect:
        bad.append(f"{rel}: 期望命中 {expect} 次，实际 {n} 次 → {old[:80]!r}")

if bad:
    print("!! 校验未通过，磁盘零改动 !!")
    for b in bad:
        print("  ×", b)
    sys.exit(1)

# 同一文件可能有多条操作，逐文件累加后一次性写盘，避免后写覆盖前写
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

print(f"\n全部 {len(OPS)} 条替换成功，覆盖 {len(by_file)} 个文件。")
