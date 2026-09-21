/**
 * 一次性数据订正：把历史审计 summary 里残留的**内部枚举**改写为中文标签。
 *
 * ⚠️ 这是**数据订正脚本**，风险等级与一次数据库迁移相同——它直接改写 `AuditEvent.summary`，
 *    而审计 summary 就是证据链本身。执行前请：
 *      1) 先备份目标库（或至少先 `--dry-run` 看清将改哪些行）；
 *      2) 确认 `DATABASE_URL` 指向**正确**的目标库（见下方「目标库可见性」）；
 *      3) 只在确有历史残留的行上使用；生产环境同样需要走变更流程。
 *
 * 目标库可见性：脚本启动即打印解析到的 `DATABASE_URL`（口令打码），让人一眼看清在动哪个库。
 *
 * 安全默认：**不带 `--apply` 时为 dry-run**——只打印「将改哪些行、前后文案」并退出，绝不写入。
 *   写入必须显式：`--apply`。`--apply` 与 `--dry-run` 不可同时给出。
 *
 * 为什么需要：审计 summary 是**持久化文案**。2026-09-18 修好生成端
 *   （launch / decisions / evidences·verify 3 处 + 同形态 6 处）后，只对**新写入**生效。
 *   旧代码写入的行仍带 `PENDING` / `DONE` / `IN_REVIEW` 等原始枚举，而 `/trace` 时间线
 *   会把 summary **逐字渲染**给使用者。
 *
 * 幂等性依据：只按 `action` 选定该动作**唯一对应**的标签表做「独立词」替换（避免 PENDING
 *   这类跨枚举歧义）；替换目标是中文标签，**已中文化的行不会再次命中**同一枚举标识，
 *   因此重复执行不会二次改写（幂等）。`ACTION_MAPS` 未覆盖的 action 一律跳过。
 *
 * 用法：
 *   # 预览（默认，不写库）
 *   NODE_OPTIONS= ./node_modules/.bin/tsx scripts/backfill-audit-summary-labels.ts
 *   # 实际写入
 *   NODE_OPTIONS= ./node_modules/.bin/tsx scripts/backfill-audit-summary-labels.ts --apply
 */
import { PrismaClient } from "@prisma/client";
import {
  LAUNCH_MILESTONE_STATUS_LABELS,
  LAUNCH_MILESTONE_KIND_LABELS,
  DECISION_PACKET_STATUS_LABELS,
  DECISION_OUTCOME_LABELS,
  EVIDENCE_VERIFY_STATUS_LABELS,
  EVIDENCE_NATURE_LABELS,
  PROJECT_MODE_LABELS,
  PROJECT_STAGE_LABELS,
  FEEDBACK_STATUS_LABELS,
  WORK_ITEM_STATUS_LABELS,
  RUN_MODE_LABELS,
  VALIDATION_STATUS_LABELS,
} from "../src/shared/status-labels";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const DRY = argv.includes("--dry-run");
if (APPLY && DRY) {
  console.error("✗ --apply 与 --dry-run 不能同时给出。");
  process.exit(2);
}
const WRITE = APPLY; // 安全默认：不带 --apply 即 dry-run

/** 口令打码，便于安全打印「在动哪个库」。 */
function maskUrl(url: string): string {
  return url.replace(/(:\/\/[^:/@]+:)[^@]*(@)/, "$1***$2");
}

const RAW_DB_URL = process.env.DATABASE_URL ?? "";
if (!RAW_DB_URL) {
  console.error("✗ 未设置 DATABASE_URL —— 拒绝在未知目标上运行。");
  process.exit(2);
}
console.log(`目标库: ${maskUrl(RAW_DB_URL)}`);
console.log(`模式  : ${WRITE ? "APPLY（实际写入）" : "DRY-RUN（只预览，不写入）"}`);
console.log("");

const prisma = new PrismaClient();

/** action → 该动作 summary 里可能出现的标签表（按序替换） */
const ACTION_MAPS: Record<string, Array<Record<string, string>>> = {
  LAUNCH_MILESTONE_UPDATED: [LAUNCH_MILESTONE_STATUS_LABELS],
  LAUNCH_MILESTONE_ADDED: [LAUNCH_MILESTONE_KIND_LABELS, LAUNCH_MILESTONE_STATUS_LABELS],
  DECISION_PACKET_SUBMITTED: [DECISION_PACKET_STATUS_LABELS],
  DECISION_PACKET_DRAFT_CREATED: [DECISION_PACKET_STATUS_LABELS],
  DECISION_DECIDED: [DECISION_OUTCOME_LABELS, DECISION_PACKET_STATUS_LABELS],
  EVIDENCE_VERIFIED: [EVIDENCE_VERIFY_STATUS_LABELS],
  EVIDENCE_REJECTED: [EVIDENCE_VERIFY_STATUS_LABELS],
  EVIDENCE_CREATED: [EVIDENCE_NATURE_LABELS],
  PROJECT_CREATED: [PROJECT_MODE_LABELS, PROJECT_STAGE_LABELS],
  FEEDBACK_DISPOSED: [FEEDBACK_STATUS_LABELS],
  WORK_SUBMISSION_RECEIVED: [WORK_ITEM_STATUS_LABELS, RUN_MODE_LABELS],
  MARKET_VALIDATION_UPDATED: [VALIDATION_STATUS_LABELS],
};

/** 对单个 summary 做一次替换；返回新串（未变化则返回原串）。 */
function relabel(action: string, summary: string): string {
  const maps = ACTION_MAPS[action];
  if (!maps) return summary;
  let out = summary;
  for (const map of maps) {
    // 只替换“独立词”形态的枚举标识，避免命中中文串里的子串
    for (const [key, label] of Object.entries(map)) {
      out = out.replace(new RegExp(`(?:^|[^\\w$])${key}(?![\\w$])`, "g"), (m) =>
        m.replace(key, label),
      );
    }
  }
  return out;
}

async function main() {
  const rows = await prisma.auditEvent.findMany({
    select: { id: true, action: true, summary: true },
  });
  const pending = rows
    .map((r) => ({ ...r, next: relabel(r.action, r.summary) }))
    .filter((r) => r.next !== r.summary);

  for (const r of pending) {
    console.log(`~ [${r.action}] ${r.summary}\n  → ${r.next}`);
  }
  console.log("");
  console.log(
    `${WRITE ? "已写入" : "将写入"} ${pending.length} 行 / 共扫描 ${rows.length} 行`,
  );

  if (WRITE) {
    for (const r of pending) {
      await prisma.auditEvent.update({ where: { id: r.id }, data: { summary: r.next } });
    }
    console.log("APPLY 完成。");
  } else {
    console.log("DRY-RUN 完成；未写入任何行。确认无误后加 --apply 重跑。");
  }
}

main()
  .catch((e) => {
    console.error("ERR", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
