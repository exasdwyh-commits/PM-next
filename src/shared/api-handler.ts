import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { AppError } from "./errors";
import crypto from "crypto";

export function handleApiError(error: unknown, req?: NextRequest) {
  const requestId = req?.headers.get("x-request-id") || crypto.randomUUID();

  // 1) 业务错误：完全由 AppError 自带的状态码/错误码决定，保持既有语义不变。
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        code: error.code,
        message: error.message,
        fieldErrors: error.fieldErrors,
        requestId,
      },
      { status: error.statusCode }
    );
  }

  const isProd = process.env.NODE_ENV === "production";
  // 非生产环境回显原始信息（便于本地/联调定位）；生产环境一律用固定通用文案，不泄漏内部细节
  // （`prisma:error` 原文、栈内字段名、绝对路径等都不下发）。
  const rawMessage = error instanceof Error ? error.message : "Internal Server Error";

  // 2) D-011：请求体不是合法 JSON / 为空 —— 这是**调用方发错了**，不是服务端崩了。
  //
  // 由来：写路由里的 `await req.json()` 在收到空 body 或非法 JSON 时，会抛出**原生
  // SyntaxError**（"Unexpected end of JSON input" / "Unexpected token ... in JSON at
  // position ..."）。它此前落到最底下的 500 兜底，于是调用方拿到「服务端崩了」，
  // 而生产环境响应体还被消毒成通用文案，调用方无从知道自己发的是坏 JSON。
  //
  // 判定刻意收窄（与 errors.ts 里 UnsupportedMediaTypeError 的风格一致）：只认带了
  // body 解析特征（message 中含 "json"）的 SyntaxError。业务代码里其它来源的
  // SyntaxError（例如 JSON.parse 外部数据）不会被误吞成 400，仍走 500 兜底。
  if (error instanceof SyntaxError && /json/i.test(error.message)) {
    console.error(`[API 400 INVALID_JSON ${requestId}]:`, error);
    return NextResponse.json(
      {
        code: "INVALID_JSON",
        message: isProd ? "Request body is not valid JSON" : rawMessage,
        requestId,
      },
      { status: 400 }
    );
  }

  // 3) D-012：Prisma 入参校验失败 —— 同样是**调用方载荷不合契约**，语义上属 422。
  //
  // 由来：缺必填字段 / 类型不符会一路冒到 Prisma，抛 `PrismaClientValidationError`
  // （例如 "Argument `targetId` is missing."）。它此前同样落到 500 兜底。
  //
  // 判定用 `instanceof`；由于 Prisma 在多份打包/多实例场景下可能存在类身份不一致，
  // 再加 `error.name === "PrismaClientValidationError"` 兜底，避免漏判。
  const isPrismaValidationError =
    error instanceof Prisma.PrismaClientValidationError ||
    (error instanceof Error && error.name === "PrismaClientValidationError");
  if (isPrismaValidationError) {
    console.error(`[API 422 UNPROCESSABLE_ENTITY ${requestId}]:`, error);
    return NextResponse.json(
      {
        code: "UNPROCESSABLE_ENTITY",
        message: isProd ? "Request payload failed validation" : rawMessage,
        requestId,
      },
      { status: 422 }
    );
  }

  // 4) D-015：Prisma **已知请求错误**（PrismaClientKnownRequestError）——同样是「调用方发错了」。
  //
  // 由来：`PrismaClientValidationError`（入参校验失败）在 D-012 已映射为 422，但
  // `PrismaClientKnownRequestError`（**执行期**的已知请求错误）一个都没映射，于是唯一键冲突等
  // 被最底下的 500 兜底吞成「服务端崩了」。契约文件早已写明却从未实施：
  // `docs/contracts/PRODUCT_CENTER_CONTRACTS.md` 第 106 行的错误码表登记「唯一键冲突未映射
  // （500，缺陷），应映射 409」；第 426 行登记为 D-001；第 576 行 I-005 记「冲突映射 409」为未实施项。
  //
  // 判定（与 errors.ts 里 UnsupportedMediaTypeError 的风格一致，且**刻意收窄**）：
  //   · instanceof `Prisma.PrismaClientKnownRequestError`；多份打包/多实例场景下类身份可能不一致，
  //     再加 `error.name === "PrismaClientKnownRequestError"` 兜底。
  //   · 只映射**确定的调用方错误**子集，其余 Prisma code（连接故障 P1001、超时等）**保持 500**，
  //     不得扩大映射把「服务端故障」也说成 409/404。
  //   · 只做 5xx→4xx 收敛，不改动任何既有 4xx/2xx 行为；不新增依赖（`@prisma/client` 已 import）。
  const isPrismaKnownError =
    error instanceof Prisma.PrismaClientKnownRequestError ||
    (error instanceof Error && error.name === "PrismaClientKnownRequestError");
  if (isPrismaKnownError) {
    const code = (error as { code?: unknown }).code;
    // 冲突目标：Prisma 的 meta.target 可能是数组（字段名）或字符串（约束名），两者都要能读。
    const rawTarget = (error as { meta?: { target?: unknown } }).meta?.target;
    const targetText = Array.isArray(rawTarget)
      ? rawTarget.join("、")
      : typeof rawTarget === "string"
        ? rawTarget
        : "";

    // 唯一键冲突 / 外键约束失败 / 关系约束被违反 → 409 CONFLICT（与 ConflictError 同码，见 §2.4）
    if (code === "P2002" || code === "P2003" || code === "P2014") {
      console.error(`[API 409 CONFLICT ${requestId}]:`, error);
      return NextResponse.json(
        {
          code: "CONFLICT",
          // 非生产回显冲突目标便于定位（如「唯一约束冲突（productId、versionTag）」）；
          // 生产环境只给固定通用文案，照抄 500 分支的消毒方式（不泄漏 code / 字段名 / 路径）。
          message: isProd
            ? "Request conflicts with existing data"
            : `数据冲突（${code}${targetText ? `：${targetText}` : ""}）`,
          requestId,
        },
        { status: 409 }
      );
    }

    // 目标记录不存在（update/delete 落空）→ 404 NOT_FOUND（与 NotFoundError 同码，见 errors.ts）
    if (code === "P2025") {
      console.error(`[API 404 NOT_FOUND ${requestId}]:`, error);
      return NextResponse.json(
        {
          code: "NOT_FOUND",
          message: isProd ? "Resource not found" : `目标记录不存在（${code}）`,
          requestId,
        },
        { status: 404 }
      );
    }
    // 其它 Prisma code（连接故障等）→ 落到下方 500 兜底，保持既有行为不变。
  }

  // 5) 真正的未知异常：保持既有 500 兜底行为不变。
  console.error(`[API Error ${requestId}]:`, error);

  return NextResponse.json(
    {
      code: "INTERNAL_ERROR",
      message: isProd ? "An internal server error occurred" : rawMessage,
      requestId,
    },
    { status: 500 }
  );
}
