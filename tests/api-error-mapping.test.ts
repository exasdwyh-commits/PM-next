/**
 * handleApiError 中央错误映射 —— 单元测试（纯函数，无需 HTTP 服务）
 *
 * 覆盖 D-011 / D-012 引入的两条映射，以及它们**刻意收窄**的边界：
 *   · 带 body 解析特征的 SyntaxError（message 含 "json"）        → 400 INVALID_JSON
 *   · 其它来源的 SyntaxError（message 不含 "json"）             → 仍为 500（不得误吞）
 *   · name === "PrismaClientValidationError"（instanceof 兜底） → 422 UNPROCESSABLE_ENTITY
 *   · AppError 分支语义不变：UnprocessableEntityError 的 fieldErrors 原样保留
 *   · 生产环境（NODE_ENV=production）下 400/422/500 均不回显内部信息，且 requestId 仍在
 *
 * 纯函数性质：handleApiError 只依赖 req 的 header 与 process.env.NODE_ENV，
 * 因此可直接构造 NextRequest（或省略），无需起服务。
 *
 * 运行：npm run test:api-errors
 *      或 bash scripts/acc-server.sh tests/api-error-mapping.test.ts
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { handleApiError } from "../src/shared/api-handler";
import { readJsonObjectBody } from "../src/shared/request-body";
import { UnprocessableEntityError } from "../src/shared/errors";

const REQ_ID = "qa-unit-req-1";
const req = new NextRequest("http://localhost/api/qa", { headers: { "x-request-id": REQ_ID } });

let passed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✔ ${name}`);
  } catch (e: any) {
    failures.push(name);
    console.log(`  ❌ ${name}\n       ${e?.message || e}`);
  }
}

/** 临时切换 NODE_ENV 调用 handleApiError，取回 { status, body } */
async function call(error: unknown, nodeEnv?: string, useReq = true) {
  // process.env.NODE_ENV 在 Next 类型里是只读字面量；用索引签名视图做临时改写。
  const env = process.env as Record<string, string | undefined>;
  const saved = env.NODE_ENV;
  if (nodeEnv !== undefined) env.NODE_ENV = nodeEnv;
  try {
    const res = handleApiError(error, useReq ? req : undefined);
    return { status: res.status, body: await res.json() };
  } finally {
    if (nodeEnv !== undefined) {
      if (saved === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = saved;
    }
  }
}

/** 把对象里所有字符串值拍平，便于做「是否泄露关键字」断言 */
const flat = (o: unknown) => JSON.stringify(o);

async function main() {
  console.log("=".repeat(72));
  console.log("🧪 handleApiError 中央错误映射 · 单元测试（D-011 / D-012）");
  console.log("=".repeat(72) + "\n");

  // ---------- ① SyntaxError → 400 INVALID_JSON（判定收窄的「正例」）----------
  console.log("▶ SyntaxError → 400 INVALID_JSON");

  for (const msg of [
    "Unexpected end of JSON input",
    "Unexpected token { in JSON at position 0",
  ]) {
    await test(`SyntaxError(${JSON.stringify(msg)}) → 400 / INVALID_JSON`, async () => {
      const { status, body } = await call(new SyntaxError(msg));
      assert.equal(status, 400);
      assert.equal(body.code, "INVALID_JSON");
      assert.equal(body.requestId, REQ_ID, "requestId 应照旧照带");
    });
  }

  // ---------- ② SyntaxError 判定收窄的「反例」：不得被吞成 400 ----------
  console.log("\n▶ SyntaxError 判定收窄（核心性质：不许把所有 SyntaxError 吞成 400）");

  await test('SyntaxError("something else entirely") → 仍为 500 / INTERNAL_ERROR', async () => {
    const { status, body } = await call(new SyntaxError("something else entirely"));
    assert.equal(status, 500, "不含 json 特征的 SyntaxError 必须走 500 兜底");
    assert.equal(body.code, "INTERNAL_ERROR");
  });

  await test('不相关的普通 Error("boom") → 500 / INTERNAL_ERROR', async () => {
    const { status, body } = await call(new Error("boom"));
    assert.equal(status, 500);
    assert.equal(body.code, "INTERNAL_ERROR");
  });

  // ---------- ③ Prisma 校验错误 → 422（instanceof / name 兜底）----------
  console.log("\n▶ Prisma 校验错误 → 422 UNPROCESSABLE_ENTITY");

  await test('name === "PrismaClientValidationError" 的 Error → 422', async () => {
    const e = new Error("Argument `targetId` is missing.");
    e.name = "PrismaClientValidationError";
    const { status, body } = await call(e);
    assert.equal(status, 422);
    assert.equal(body.code, "UNPROCESSABLE_ENTITY");
    assert.equal(body.requestId, REQ_ID);
  });

  await test("普通 Error 的 name 不是 Prisma 校验错误 → 不得误判为 422", async () => {
    const e = new Error("Argument `x` is missing.");
    e.name = "Error"; // 文案像 Prisma，但 name 不符 → 仍 500
    const { status } = await call(e);
    assert.equal(status, 500);
  });

  // ---------- ④ AppError 分支语义未被改动（fieldErrors 原样保留）----------
  console.log("\n▶ AppError 分支语义不变（回归护栏）");

  await test("UnprocessableEntityError 的 fieldErrors 原样保留（422）", async () => {
    const e = new UnprocessableEntityError("x", { f: ["必填"] });
    const { status, body } = await call(e);
    assert.equal(status, 422);
    assert.equal(body.code, "UNPROCESSABLE_ENTITY");
    assert.deepEqual(body.fieldErrors, { f: ["必填"] }, "fieldErrors 必须原样下发");
  });

  await test("AppError 优先于 SyntaxError 分支：即使 message 含 json 也按自身 code", async () => {
    const e = new UnprocessableEntityError("invalid json payload per business rule");
    const { status, body } = await call(e);
    assert.equal(status, 422);
    // AppError 分支的 code 是业务自带 code，而不是被 SyntaxError 分支覆盖
    assert.equal(body.code, "UNPROCESSABLE_ENTITY");
  });

  // ---------- ⑤ 生产环境不泄漏内部信息 ----------
  console.log("\n▶ 生产环境（NODE_ENV=production）响应体不泄漏内部信息");

  const SECRETS = ["prisma:error", "SyntaxError", "Unexpected", "/Users/", "node_modules", "at Object"];
  const noLeak = async (label: string, error: unknown, wantStatus: number) => {
    await test(`${label} → ${wantStatus} 且 message 不含内部信息、requestId 仍在`, async () => {
      const { status, body } = await call(error, "production");
      assert.equal(status, wantStatus);
      const s = flat(body);
      for (const kw of SECRETS) {
        assert.ok(!s.includes(kw), `响应体不应出现 "${kw}"：${s}`);
      }
      // 400/422 有固定通用文案；500 也有。三者都应是与内部实现无关的泛化文案。
      assert.ok(typeof body.message === "string" && body.message.length > 0, "message 应为非空泛化文案");
      assert.ok(body.requestId, "requestId 应仍在");
    });
  };

  await noLeak("SyntaxError(含内部路径)", new SyntaxError("Unexpected end of JSON input"), 400);
  await noLeak(
    "PrismaClientValidationError(含字段名)",
    Object.assign(new Error("Argument `targetId` is missing. prisma:error /Users/secret/schema.prisma"), {
      name: "PrismaClientValidationError",
    }),
    422
  );
  await noLeak("未知 Error(含栈线索)", new Error("boom at Object.<anonymous> (/Users/secret/x.ts:1)"), 500);

  // ---------- ⑥ D-015：Prisma 已知请求错误 → 409 / 404（判定刻意收窄）----------
  console.log("\n▶ Prisma 已知请求错误 → 409 CONFLICT / 404 NOT_FOUND（D-015）");

  const knownError = (code: string, meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError("Prisma request error", {
      code,
      clientVersion: "test",
      meta: meta as never,
    });

  await test("P2002（唯一约束）真实类 → 409 / CONFLICT，requestId 在", async () => {
    const { status, body } = await call(knownError("P2002", { target: ["productId", "versionTag"] }));
    assert.equal(status, 409);
    assert.equal(body.code, "CONFLICT");
    assert.equal(body.requestId, REQ_ID);
  });

  await test('name === "PrismaClientKnownRequestError" 兜底（多实例）→ 409', async () => {
    const e = Object.assign(new Error("Unique constraint failed"), {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      meta: { target: ["identityCode"] },
    });
    const { status, body } = await call(e);
    assert.equal(status, 409);
    assert.equal(body.code, "CONFLICT");
  });

  await test("P2003（外键约束失败）→ 409 / CONFLICT", async () => {
    const { status, body } = await call(knownError("P2003", { field_name: "productId" }));
    assert.equal(status, 409);
    assert.equal(body.code, "CONFLICT");
  });

  await test("P2014（关系约束被违反）→ 409 / CONFLICT", async () => {
    const { status, body } = await call(knownError("P2014"));
    assert.equal(status, 409);
    assert.equal(body.code, "CONFLICT");
  });

  await test("P2025（目标记录不存在）→ 404 / NOT_FOUND", async () => {
    const { status, body } = await call(knownError("P2025"));
    assert.equal(status, 404);
    assert.equal(body.code, "NOT_FOUND");
    assert.equal(body.requestId, REQ_ID);
  });

  await test("【收窄核心】P1001（连接故障）→ 仍 500，不得被映射成 409/404", async () => {
    const { status, body } = await call(knownError("P1001"));
    assert.equal(status, 500, "连接故障是服务端问题，必须保持 500 兜底");
    assert.equal(body.code, "INTERNAL_ERROR");
  });

  await test("生产环境 P2002 → 409 且不含 P2002 / 字段名 / 内部路径", async () => {
    const { status, body } = await call(
      Object.assign(new Error("Unique constraint failed prisma:error /Users/secret/schema.prisma"), {
        name: "PrismaClientKnownRequestError",
        code: "P2002",
        meta: { target: ["identityCode"], file: "/Users/secret/schema.prisma" },
      }),
      "production"
    );
    assert.equal(status, 409);
    const s = flat(body);
    for (const kw of ["P2002", "identityCode", "prisma:error", "/Users/", "schema.prisma"]) {
      assert.ok(!s.includes(kw), `生产环境 409 响应体不应出现 "${kw}"：${s}`);
    }
  });

  await noLeak(
    "PrismaClientKnownRequestError P2002（meta 含绝对路径）",
    Object.assign(new Error("Unique constraint failed prisma:error at /Users/secret/schema.prisma"), {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      meta: { target: ["identityCode"], file: "/Users/secret/schema.prisma" },
    }),
    409
  );

  // ---------- ⑦ D-016：readJsonObjectBody 三态 ----------
  console.log("\n▶ readJsonObjectBody 三态：无 body / 畸形 / 非对象（D-016）");

  const mkReq = (body?: string) =>
    new NextRequest("http://localhost/api/qa", {
      method: "POST",
      ...(body === undefined ? {} : { body }),
    });

  await test("无 body（空字符串）→ 返回 {}", async () => {
    const out = await readJsonObjectBody(mkReq());
    assert.deepEqual(out, {});
  });

  await test("合法 JSON 对象 → 原样返回", async () => {
    const out = await readJsonObjectBody(mkReq('{"a":1}'));
    assert.deepEqual(out, { a: 1 });
  });

  await test('畸形 JSON "{" → 抛出且 message 含 "JSON"（将被中央映射成 400）', async () => {
    await assert.rejects(
      () => readJsonObjectBody(mkReq("{")),
      (e: any) => e instanceof SyntaxError && /json/i.test(e.message)
    );
  });

  const nonObjects: Array<[string, string]> = [
    ["null", "null"],
    ["数组 []", "[]"],
    ['字符串 "x"', '"x"'],
    ["数字 1", "1"],
  ];
  for (const [label, raw] of nonObjects) {
    await test(`非对象 ${label} → 抛 UnprocessableEntityError(422)`, async () => {
      await assert.rejects(
        () => readJsonObjectBody(mkReq(raw)),
        (e: any) => e instanceof UnprocessableEntityError && e.statusCode === 422
      );
    });
  }

  // ---------- 汇总 ----------
  console.log("\n" + "=".repeat(72));
  if (failures.length === 0) {
    console.log(`🏆 handleApiError 单元测试全绿：${passed} 项断言全部通过`);
  } else {
    console.log(`❌ handleApiError 单元测试失败 ${failures.length} 项 / 通过 ${passed} 项：`);
    failures.forEach((f) => console.log(`   - ${f}`));
  }
  console.log("=".repeat(72) + "\n");
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("❌ 单元测试异常终止:", e?.message || e);
  process.exitCode = 1;
});
