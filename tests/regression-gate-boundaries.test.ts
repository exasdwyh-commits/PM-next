/**
 * 门禁边界与幂等作用域回归锁（TASK-003b）
 *
 * 盯住两类 TASK-003a 已复现的缺陷，防止回退：
 *   ① **门禁集中保护**：`decideDecisionPacket` 的 APPROVE 分支此前不按 `GateType` 分派，
 *      任何门型批准都会把 `Project.stage` 无条件推进到 `SAMPLING` 并派生打样任务。
 *      修复后：只有 `RESEARCH_SAMPLING_GATE`（G1）被视为「已实现」；未实现门型
 *      （当前 `PRODUCTION_GATE`）在 `assertGateImplemented()` 处 **fail-closed 422**。
 *   ③ **幂等命令范围**：`checkOrRecordIdempotency()` 读取分支此前只比 `requestHash`/`actorId`，
 *      未比 `commandScope` → 同键跨命令会命中旧记录并返回**别的命令**的历史响应。
 *      修复后：作用域 = `(actorId, commandScope)`，不一致即 409；合法重放仍成立。
 *
 * 本测试为**纯逻辑**（无 DB 依赖）：① 直接调纯函数；③ 用内存 fake `tx` 替换
 * `Prisma.TransactionClient`。运行：
 *   node_modules/.bin/tsx tests/regression-gate-boundaries.test.ts
 * 或（仓库既有跑法）：
 *   node_modules/.bin/tsx scripts/run-test.ts tests/regression-gate-boundaries.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { GateType } from "@prisma/client";
import { assertGateImplemented, isGateImplemented } from "../src/modules/decisions/service";
import { checkOrRecordIdempotency } from "../src/shared/idempotency";
import { UnprocessableEntityError, ConflictError } from "../src/shared/errors";

// ───────────────────────────────────────────────────────────────────────────
// ① 门禁集中保护
// ───────────────────────────────────────────────────────────────────────────

/** 全枚举取值（若将来枚举新增门型，本测试会随之覆盖并可能变红，正是提醒改文档/实现的信号）。 */
const ALL_GATES = Object.values(GateType) as GateType[];

test("① 正例：G1（RESEARCH_SAMPLING_GATE）已实现，断言不抛", () => {
  assert.equal(isGateImplemented(GateType.RESEARCH_SAMPLING_GATE), true);
  assert.doesNotThrow(() => assertGateImplemented(GateType.RESEARCH_SAMPLING_GATE));
});

test("① 归类表：已实现门型集合恰为 {RESEARCH_SAMPLING_GATE}", () => {
  const implemented = ALL_GATES.filter(isGateImplemented);
  assert.deepEqual(implemented, [GateType.RESEARCH_SAMPLING_GATE]);
  // 明确锁住「PRODUCTION_GATE 未实现」——G2 是计划所称的“空门”，本批只封堵不实现。
  assert.equal(isGateImplemented(GateType.PRODUCTION_GATE), false);
});

// 反例：逐门型参数化 —— 每个未实现门型都必须 422
for (const gate of ALL_GATES) {
  if (gate === GateType.RESEARCH_SAMPLING_GATE) continue;
  test(`① 反例：未实现门型 ${gate} → 422`, () => {
    assert.throws(
      () => assertGateImplemented(gate),
      (e: unknown) =>
        e instanceof UnprocessableEntityError &&
        (e as UnprocessableEntityError).statusCode === 422
    );
  });
}

// ───────────────────────────────────────────────────────────────────────────
// ③ 幂等命令范围
// ───────────────────────────────────────────────────────────────────────────

interface Rec {
  key: string;
  actorId: string;
  commandScope: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
}

/** 内存 fake tx：只实现本函数用到的 findUnique / create。 */
function fakeTx(store: Rec[]) {
  return {
    idempotencyRecord: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        store.find((r) => r.key === where.key) ?? null,
      create: async ({ data }: { data: Rec }) => {
        store.push(data);
        return data;
      },
    },
  } as unknown as Parameters<typeof checkOrRecordIdempotency>[0];
}

const baseRec = (over: Partial<Rec> = {}): Rec => ({
  key: "K",
  actorId: "A",
  commandScope: "SCOPE_A",
  requestHash: "H",
  responseStatus: 200,
  responseBody: { from: "SCOPE_A" },
  ...over,
});

test("③ 正例：同 key/actor/payload/scope → wasReplayed=true 且 execute 不被调用", async () => {
  let executed = false;
  const r = await checkOrRecordIdempotency(
    fakeTx([baseRec()]),
    "K",
    "A",
    "SCOPE_A",
    "H",
    async () => {
      executed = true;
      return { status: 201, body: { fresh: true } };
    }
  );
  assert.equal(r.wasReplayed, true);
  assert.equal(executed, false, "合法重放不得再执行命令体");
  assert.deepEqual(r.body, { from: "SCOPE_A" });
});

test("③ 正例：无既有记录 → execute 被调用一次并写入", async () => {
  const store: Rec[] = [];
  let calls = 0;
  const r = await checkOrRecordIdempotency(
    fakeTx(store),
    "K",
    "A",
    "SCOPE_A",
    "H",
    async () => {
      calls += 1;
      return { status: 201, body: { fresh: true } };
    }
  );
  assert.equal(r.wasReplayed, false);
  assert.equal(calls, 1);
  assert.equal(store.length, 1);
  assert.equal(store[0].commandScope, "SCOPE_A");
});

test("③ 反例：同 actor 同 payload **不同 scope** → 409（跨命令重放已封堵）", async () => {
  await assert.rejects(
    () =>
      checkOrRecordIdempotency(fakeTx([baseRec()]), "K", "A", "SCOPE_B", "H", async () => ({
        status: 201,
        body: { fresh: true },
      })),
    (e: unknown) => e instanceof ConflictError && (e as ConflictError).statusCode === 409
  );
});

test("③ 反例：不同 payload → 409", async () => {
  await assert.rejects(
    () =>
      checkOrRecordIdempotency(fakeTx([baseRec()]), "K", "A", "SCOPE_A", "H_DIFF", async () => ({
        status: 201,
        body: {},
      })),
    (e: unknown) => e instanceof ConflictError && (e as ConflictError).statusCode === 409
  );
});

test("③ 反例：不同 actor → 409", async () => {
  await assert.rejects(
    () =>
      checkOrRecordIdempotency(fakeTx([baseRec()]), "K", "OTHER_ACTOR", "SCOPE_A", "H", async () => ({
        status: 201,
        body: {},
      })),
    (e: unknown) => e instanceof ConflictError && (e as ConflictError).statusCode === 409
  );
});

test("③ 错误信息按原因分类且**不回显请求体/键值内容**", async () => {
  try {
    await checkOrRecordIdempotency(fakeTx([baseRec()]), "K", "A", "SCOPE_B", "H", async () => ({
      status: 201,
      body: {},
    }));
    assert.fail("应当抛 ConflictError");
  } catch (e) {
    assert.ok(e instanceof ConflictError);
    const msg = (e as Error).message;
    assert.match(msg, /commandScope/, "应点名 commandScope 这一原因");
    assert.doesNotMatch(msg, /SCOPE_A|SCOPE_B/, "不得回显 scope 值/请求内容");
    assert.doesNotMatch(msg, /"from"/, "不得回显请求体内容");
  }
});
