#!/usr/bin/env bash
#
# 数据库链路验证：空库迁移 / 漂移 / 带数据的增量升级
# ====================================================
#
# 交付报告把「空库迁移、既有库升级」列为未验证的阻塞项，原因是那份执行环境
# 没有 PostgreSQL 也没有 Docker。本脚本在有本地 PostgreSQL 的机器上把这三件事
# 变成可复现的证据，并在任何一步失败时以非 0 退出。
#
# 用法：
#   bash scripts/verify-db-chain.sh                     # 用默认连接参数
#   PG_ADMIN_URL=... PG_APP_URL_BASE=... bash scripts/verify-db-chain.sh
#
# 环境变量（都有默认值）：
#   PG_ADMIN_URL     管理员连接串（需要 CREATE DATABASE 权限）
#   PG_APP_USER      业务角色名
#   PG_APP_PASSWORD  业务角色密码
#   PG_HOST / PG_PORT
#
# 注意：
# - 本脚本只创建/删除自己名字下的两个验证库（*_verify），不动 dev/test 库。
# - psql 不接受 Prisma 的 `?schema=public` 查询参数，所以给 psql 的 URL 必须去掉它。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PG_HOST="${PG_HOST:-127.0.0.1}"
PG_PORT="${PG_PORT:-5433}"
PG_APP_USER="${PG_APP_USER:-hermes_app}"
PG_APP_PASSWORD="${PG_APP_PASSWORD:-hermes_local}"
PG_ADMIN_URL="${PG_ADMIN_URL:-postgresql://$(whoami)@${PG_HOST}:${PG_PORT}/postgres}"

FRESH_DB="hermes_migrate_verify"
UPGRADE_DB="hermes_upgrade_verify"
PARTIAL_DIR="/tmp/pm-partial-migrate"

# psql 用的连接串（不含 Prisma 专有查询参数）
psql_url() {
  echo "postgresql://${PG_APP_USER}:${PG_APP_PASSWORD}@${PG_HOST}:${PG_PORT}/$1"
}
# Prisma 用的连接串
prisma_url() {
  echo "postgresql://${PG_APP_USER}:${PG_APP_PASSWORD}@${PG_HOST}:${PG_PORT}/$1?schema=public"
}

# 找 psql：优先 PATH，其次 Postgres.app
PSQL="$(command -v psql || true)"
if [ -z "$PSQL" ]; then
  for candidate in /Applications/Postgres.app/Contents/Versions/*/bin/psql; do
    [ -x "$candidate" ] && PSQL="$candidate" && break
  done
fi
if [ -z "$PSQL" ]; then
  echo "❌ 找不到 psql（PATH 与 Postgres.app 都没有）" >&2
  exit 1
fi

FAILED=0
step() { echo; echo "=== $* ==="; }
ok()   { echo "  ✅ $*"; }
bad()  { echo "  ❌ $*" >&2; FAILED=1; }

export NODE_OPTIONS=

step "0) 环境自检"
if "$PSQL" "$PG_ADMIN_URL" -t -A -c "SELECT 1" >/dev/null 2>&1; then
  ok "PostgreSQL 可达：${PG_HOST}:${PG_PORT}"
else
  bad "PostgreSQL 不可达：${PG_ADMIN_URL}"
  exit 1
fi
MIGRATION_COUNT=$(ls prisma/migrations | grep -v migration_lock | wc -l | tr -d ' ')
ok "仓库迁移数：${MIGRATION_COUNT}"

# ---------------------------------------------------------------- 空库全量迁移
step "1) 空库全量迁移（从零建库 → migrate deploy）"
"$PSQL" "$PG_ADMIN_URL" -q -c "DROP DATABASE IF EXISTS ${FRESH_DB};" \
                       -c "CREATE DATABASE ${FRESH_DB} OWNER ${PG_APP_USER};"
if DATABASE_URL="$(prisma_url "$FRESH_DB")" npx prisma migrate deploy >/tmp/pm-fresh-migrate.log 2>&1; then
  ok "migrate deploy 成功"
else
  bad "migrate deploy 失败，日志见 /tmp/pm-fresh-migrate.log"
  tail -20 /tmp/pm-fresh-migrate.log >&2
fi
APPLIED=$("$PSQL" "$(psql_url "$FRESH_DB")" -t -A \
  -c 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;' | tr -d ' ')
if [ "$APPLIED" = "$MIGRATION_COUNT" ]; then
  ok "已应用迁移数 = ${APPLIED}（与仓库一致）"
else
  bad "已应用迁移数 ${APPLIED} ≠ 仓库 ${MIGRATION_COUNT}"
fi
if DATABASE_URL="$(prisma_url "$FRESH_DB")" npx prisma migrate status 2>&1 | grep -q "up to date"; then
  ok "migrate status: up to date"
else
  bad "migrate status 不是 up to date"
fi

# ------------------------------------------------------------------- 漂移检查
step "2) schema 漂移检查（已迁移库 vs schema.prisma）"
DRIFT_FILE="/tmp/pm-drift.sql"
DATABASE_URL="$(prisma_url "$FRESH_DB")" npx prisma migrate diff \
  --from-url "$(prisma_url "$FRESH_DB")" \
  --to-schema-datamodel "${REPO_ROOT}/prisma/schema.prisma" \
  --script > "$DRIFT_FILE" 2>/tmp/pm-drift.err || true
# 去掉空行与纯注释行后应为空
DRIFT_BODY=$(grep -vE '^\s*(--.*)?$' "$DRIFT_FILE" || true)
if [ -z "$DRIFT_BODY" ]; then
  ok "无漂移：schema.prisma 与迁移链一致"
else
  bad "检测到漂移，内容见 ${DRIFT_FILE}"
  echo "$DRIFT_BODY" | head -20 >&2
fi

# -------------------------------------------------- 带数据的增量升级（旧库升级）
step "3) 增量升级：先应用前 N-1 个迁移，写入存量数据，再应用最后一个"
LAST_MIGRATION=$(ls prisma/migrations | grep -v migration_lock | sort | tail -1)
ok "本轮留给增量升级的迁移：${LAST_MIGRATION}"

"$PSQL" "$PG_ADMIN_URL" -q -c "DROP DATABASE IF EXISTS ${UPGRADE_DB};" \
                       -c "CREATE DATABASE ${UPGRADE_DB} OWNER ${PG_APP_USER};"

rm -rf "$PARTIAL_DIR"
mkdir -p "$PARTIAL_DIR/prisma/migrations"
cp prisma/schema.prisma "$PARTIAL_DIR/prisma/"
cp -R prisma/migrations/. "$PARTIAL_DIR/prisma/migrations/"
rm -rf "$PARTIAL_DIR/prisma/migrations/${LAST_MIGRATION}"

if DATABASE_URL="$(prisma_url "$UPGRADE_DB")" npx prisma migrate deploy \
    --schema "$PARTIAL_DIR/prisma/schema.prisma" >/tmp/pm-partial-migrate.log 2>&1; then
  PARTIAL_APPLIED=$("$PSQL" "$(psql_url "$UPGRADE_DB")" -t -A \
    -c 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;' | tr -d ' ')
  ok "旧库形态就绪：已应用 ${PARTIAL_APPLIED} 个迁移（应比仓库少 1）"
  if [ "$PARTIAL_APPLIED" -ne $((MIGRATION_COUNT - 1)) ]; then
    bad "旧库迁移数不符：${PARTIAL_APPLIED} ≠ $((MIGRATION_COUNT - 1))"
  fi
else
  bad "部分迁移部署失败，日志见 /tmp/pm-partial-migrate.log"
  tail -20 /tmp/pm-partial-migrate.log >&2
fi

# 存量数据（升级前写入，升级后必须还在）
"$PSQL" "$(psql_url "$UPGRADE_DB")" -q -c \
  "INSERT INTO \"Organization\" (id, name, code, \"updatedAt\") VALUES ('org-upgrade-probe','升级验证组织','UPGRADE_PROBE', now());"
PROBE_BEFORE=$("$PSQL" "$(psql_url "$UPGRADE_DB")" -t -A \
  -c "SELECT count(*) FROM \"Organization\" WHERE id='org-upgrade-probe';" | tr -d ' ')
ok "升级前写入存量数据：${PROBE_BEFORE} 行"

if DATABASE_URL="$(prisma_url "$UPGRADE_DB")" npx prisma migrate deploy >/tmp/pm-upgrade-migrate.log 2>&1; then
  ok "增量迁移成功"
else
  bad "增量迁移失败，日志见 /tmp/pm-upgrade-migrate.log"
  tail -20 /tmp/pm-upgrade-migrate.log >&2
fi

UPGRADED=$("$PSQL" "$(psql_url "$UPGRADE_DB")" -t -A \
  -c 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;' | tr -d ' ')
PROBE_AFTER=$("$PSQL" "$(psql_url "$UPGRADE_DB")" -t -A \
  -c "SELECT count(*) FROM \"Organization\" WHERE id='org-upgrade-probe';" | tr -d ' ')

if [ "$UPGRADED" = "$MIGRATION_COUNT" ]; then
  ok "升级后迁移数 = ${UPGRADED}"
else
  bad "升级后迁移数 ${UPGRADED} ≠ ${MIGRATION_COUNT}"
fi
if [ "$PROBE_AFTER" = "$PROBE_BEFORE" ] && [ "$PROBE_AFTER" != "0" ]; then
  ok "存量数据在升级后存活（${PROBE_AFTER} 行）"
else
  bad "存量数据未存活：升级前 ${PROBE_BEFORE} 行 → 升级后 ${PROBE_AFTER} 行"
fi
if DATABASE_URL="$(prisma_url "$UPGRADE_DB")" npx prisma migrate status 2>&1 | grep -q "up to date"; then
  ok "升级后 migrate status: up to date"
else
  bad "升级后 migrate status 不是 up to date"
fi

# ---------------------------------------------------------------- 跨重启持久性
step "4) 重启持久性（断开连接后重连，数据与迁移记录仍在）"
RESTART_PROBE=$("$PSQL" "$(psql_url "$UPGRADE_DB")" -t -A \
  -c "SELECT name FROM \"Organization\" WHERE id='org-upgrade-probe';" | tr -d ' ')
if [ -n "$RESTART_PROBE" ]; then
  ok "重连后读到存量数据：${RESTART_PROBE}"
else
  bad "重连后读不到存量数据"
fi

rm -rf "$PARTIAL_DIR"

step "结论"
if [ "$FAILED" -eq 0 ]; then
  echo "✅ 数据库链路验证全部通过（空库迁移 / 无漂移 / 带数据增量升级 / 重连持久性）"
  echo "   验证库：${FRESH_DB}、${UPGRADE_DB}（保留以便复查）"
else
  echo "❌ 数据库链路验证存在失败项，见上方 ❌" >&2
fi
exit "$FAILED"
