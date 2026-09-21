/**
 * TASK-003a 只读复现探针（下划线开头，**不提交**）
 *
 * 目的：判定 `checkOrRecordIdempotency()` 是否会在 **相同 actor + 相同 payload** 但
 * **不同 commandScope** 时命中旧记录（= 跨命令重放）。
 *
 * 本探针为**纯逻辑**：用一个内存 fake `tx` 替换 `Prisma.TransactionClient`，
 * **不连库、不起服务**。运行：
 *   node_modules/.bin/tsx scripts/_probe-idempotency-scope.ts
 */

import { checkOrRecordIdempotency } from "../src/shared/idempotency";

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

async function main() {
  const out: string[] = [];

  // ── 负例：同 key / 同 actor / 同 requestHash，**不同 commandScope** ──────────
  {
    const store: Rec[] = [
      { key: "K1", actorId: "A", commandScope: "SCOPE_A", requestHash: "H", responseStatus: 200, responseBody: { from: "SCOPE_A" } },
    ];
    let executed = false;
    try {
      const r = await checkOrRecordIdempotency(fakeTx(store), "K1", "A", "SCOPE_B", "H", async () => {
        executed = true;
        return { status: 201, body: { from: "SCOPE_B" } };
      });
      out.push(
        `NEG  (scope 不同): NO-THROW  wasReplayed=${r.wasReplayed}  body=${JSON.stringify(r.body)}  execute被调用=${executed}` +
          `  => ${r.wasReplayed ? "命中旧记录=跨命令重放【复现】" : "未重放"}`
      );
    } catch (e) {
      out.push(`NEG  (scope 不同): THROW "${(e as Error).message}"  => 已阻断`);
    }
  }

  // ── 正例：同 key / 同 actor / 同 requestHash / **同 commandScope** ──────────
  {
    const store: Rec[] = [
      { key: "K2", actorId: "A", commandScope: "SCOPE_A", requestHash: "H", responseStatus: 200, responseBody: { from: "SCOPE_A" } },
    ];
    let executed = false;
    try {
      const r = await checkOrRecordIdempotency(fakeTx(store), "K2", "A", "SCOPE_A", "H", async () => {
        executed = true;
        return { status: 201, body: { from: "SCOPE_A" } };
      });
      out.push(
        `POS  (scope 相同): wasReplayed=${r.wasReplayed}  execute被调用=${executed}` +
          `  => ${r.wasReplayed ? "合法复用【预期】" : "未重放(异常)"}`
      );
    } catch (e) {
      out.push(`POS  (scope 相同): THROW "${(e as Error).message}"  => 误阻断(异常)`);
    }
  }

  // ── 对照：同 key / 同 actor / 同 scope，**不同 requestHash**（应当 409）──────
  {
    const store: Rec[] = [
      { key: "K3", actorId: "A", commandScope: "SCOPE_A", requestHash: "H", responseStatus: 200, responseBody: {} },
    ];
    try {
      await checkOrRecordIdempotency(fakeTx(store), "K3", "A", "SCOPE_A", "H_DIFF", async () => ({ status: 201, body: {} }));
      out.push(`CTRL (payload 不同): NO-THROW  => 未阻断(异常)`);
    } catch (e) {
      out.push(`CTRL (payload 不同): THROW "${(e as Error).message}"  => 已阻断【预期】`);
    }
  }

  console.log(out.join("\n"));
}

void main();
