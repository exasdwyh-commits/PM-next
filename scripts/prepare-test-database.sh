#!/usr/bin/env bash
# Makes the dedicated test database reproducible without resetting or touching development data.
#
# 4b 加固（TASK-004）：不再把「有账本」当「结构正确」。
#   - 失败/未完成迁移 → 拒绝（ts 报出迁移名）。
#   - 账本齐全但结构与 schema 不一致 → 拒绝（structure-unverified）。
#   - current（结构来自 db push）补账本前打印**醒目警告**（迁移未执行、链仍不可回放）。
# 迁移链本身仍不可回放 —— 那是 TASK-007 的事，本脚本只保证「不再说谎」。
set -euo pipefail
cd "$(dirname "$0")/.."

[[ -f .env ]] || { echo "Missing .env"; exit 1; }
set -a; . ./.env; set +a
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL is not defined in .env}"

state="$(NODE_OPTIONS= ./node_modules/.bin/tsx scripts/prepare-test-database.ts)"
case "$state" in
  legacy-untracked)
    echo "⚠️  账本为补齐：把前 6 个迁移标为已应用（**不执行 DDL**），随后 deploy 跑剩余迁移。"
    echo "    迁移链整体仍不可回放（D-006 / docs/product-center/MIGRATION_REPLAY_REPORT.md / TASK-007）。"
    for migration in \
      0_init \
      20260908070000_add_artifact_applicability \
      20260908090000_user_password_hash \
      20260909010000_add_evidence_claims_and_gaps \
      20260913090000_add_opportunity_validation_fields \
      20260913220000_add_product_dev_advisor_knowledge_launch; do
      DATABASE_URL="$TEST_DATABASE_URL" ./node_modules/.bin/prisma migrate resolve --applied "$migration" --schema prisma/schema.prisma >/dev/null
    done
    ;;
  managed)
    echo "Test database ledger verified AND structure matches schema (managed)"
    ;;
  pending)
    # 账本齐全但磁盘上有未应用迁移：这是**正常前进**（不是「账本与结构不符」）。
    # 交由下方 `migrate deploy` 应用，再由收尾的 `managed` 校验结构确实收敛到 schema。
    echo "ℹ️  账本齐全，存在未应用迁移 → 交由 deploy 前进（deploy 后校验结构）。"
    ;;
  current)
    echo "⚠️⚠️  current：测试库结构来自 db push，账本即将被『补齐为全跑过』——但迁移从未执行。"
    echo "      因此 migrate status 变绿 ≠ 结构由迁移建出；迁移链仍不可回放（D-006 / TASK-007）。"
    echo "      如需真实可回放，请等 TASK-007 修好迁移链后由迁移重建本库。"
    for migration in \
      0_init \
      20260908070000_add_artifact_applicability \
      20260908090000_user_password_hash \
      20260909010000_add_evidence_claims_and_gaps \
      20260913090000_add_opportunity_validation_fields \
      20260913220000_add_product_dev_advisor_knowledge_launch \
      20260916010000_org_membership_signal_scope_artifact_fields \
      20260919010000_add_run_mode_llm; do
      DATABASE_URL="$TEST_DATABASE_URL" ./node_modules/.bin/prisma migrate resolve --applied "$migration" --schema prisma/schema.prisma >/dev/null
    done
    ;;
  failed-migrations)
    echo "❌ 拒绝：测试库存在失败/未完成迁移（具体迁移名见上方 stderr）。"
    echo "   本脚本不在失败账本上继续；请修复迁移链（TASK-007）后重建测试库。"
    exit 1
    ;;
  structure-unverified)
    echo "❌ 拒绝：账本齐全，但结构未通过校验（实库与 schema.prisma 不一致，差异见上方）。"
    echo "   本脚本不把『有账本』当『结构正确』；请用迁移重建测试库（TASK-007 修好后）或人工核对。"
    exit 1
    ;;
esac
# 注：真正的「未知状态」拒绝在 ts 层 —— scripts/prepare-test-database.ts 的 getState()：
#   · 库名不以 *_test 结尾 / 角色不符 → throw
#   · 无账本且不匹配 legacy/current → throw（"Refusing to guess its history"）
# 因此这里**不再保留** `case *)`：旧版那段在 ts 只会输出 5 个已知状态（或抛错）时**永不执行**，
# 属「看起来在防护、实际是死代码」。未知状态由 ts 抛错 + `set -e` 拦截。

DATABASE_URL="$TEST_DATABASE_URL" ./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma
final_state="$(NODE_OPTIONS= ./node_modules/.bin/tsx scripts/prepare-test-database.ts)"
[[ "$final_state" == "managed" ]] || { echo "Test database migration ledger was not created"; exit 1; }
echo "Test database is ready"
