import { NextRequest } from "next/server";
import { UnprocessableEntityError } from "./errors";

/**
 * 读可选 JSON 请求体（D-016）。
 *
 * ## 背景（为什么需要它）
 *
 * 写路由里此前普遍写 `const body = await req.json().catch(() => ({}))` —— 它把
 * **畸形 JSON 静默当成空 body**。危害不均，其中一条是实打实的 **fail-open**：
 *
 * ```ts
 * // src/app/api/evidences/[id]/verify/route.ts（修复前）
 * const body = await req.json().catch(() => ({}));
 * const newStatus = body.status === "REJECTED" ? REJECTED : VERIFIED; // 条件不成立 → 通过
 * ```
 *
 * 调用方本意「**驳回**证据」，只要 body 是畸形 JSON，就被静默当作空 body → 条件不成立 →
 * 执行成「**通过**」，而且 `$transaction` 里还会写 `action: "EVIDENCE_VERIFIED"` 审计事件。
 * 证据核实是 G4 打样门槛的前置，把「驳回」静默翻成「通过」是最严重的一种。
 * 其它站点多为「字段静默丢失后按默认值继续跑」（例如 analyses 的 `kind` 退化成 BASELINE）。
 *
 * ## 为什么**不能**直接删掉 `.catch`
 *
 * 因为「**POST 不带 body**」是既有被支持的**合法**调用：前端 `launch-tab.tsx` 用
 * `call(path, "POST", {...})`，测试脚手架里有大量 `api("POST", path)` 不传 body。
 * 删掉 `.catch` 会让 `JSON.parse("")` 抛 SyntaxError → 400，**误伤所有合法空 body 调用**。
 *
 * ## 三种情况必须区分对待
 *
 * | 情况 | 行为 |
 * | --- | --- |
 * | ① 真正没 body（`req.text()` trim 后为空） | 返回 `{}`（**合法**，保持既有语义） |
 * | ② 有 body 但解析失败 | **原样抛**（原生 SyntaxError，message 含 "JSON"，由 D-011 中央映射 → 400 `INVALID_JSON`） |
 * | ③ 有 body、是合法 JSON、但**不是普通对象**（`null` / `[]` / `"x"` / `1`） | 抛 `UnprocessableEntityError`（**422**） |
 *
 * 第 ③ 种此前也是漏的：例如 `verify` 传 body 字面量 `null`，`JSON.parse` 成功返回 `null`，
 * `.catch` 根本不触发，接着 `body.status` 抛 **TypeError → 500**。把它收敛为 422，
 * 而不是像旧写法那样当 `{}` —— 那正是 D-016 的 fail-open 来源。
 *
 * ## 实现约定
 *
 * ② 处**刻意不 catch** JSON.parse 的异常：交给中央 `handleApiError` 统一映射成 400，
 * 避免每条路由各自决定「坏 JSON」的语义（判定收窄也已集中在 `api-handler.ts` 的 D-011 分支）。
 *
 * @param req Next.js 路由的 `NextRequest`
 * @returns 解析后的 JSON 对象（无 body 时为 `{}`）
 * @throws {UnprocessableEntityError} body 是合法 JSON 但不是对象（422）
 * @throws {SyntaxError} body 非空但不是合法 JSON（含 "JSON" 字样，中央映射 → 400）
 *
 * 返回类型用 `Record<string, any>`（而非 `Record<string, unknown>`）：本助手是
 * `req.json()` 的**替换品**，而 `req.json()` 返回 `any` —— 各调用点普遍写
 * `body?.title` / `body.title` 并直接传给强类型服务函数。若返回 `unknown`，
 * 会迫使所有调用点加断言/强转，扩大改动面并可能引入新的类型谎报。
 * 这里保留既有宽松度，把「是不是对象」的判断放在运行时（见 ③），不靠类型系统。
 */
export async function readJsonObjectBody(req: NextRequest): Promise<Record<string, any>> {
  const raw = await req.text();

  // ① 真正没 body：空字符串（或纯空白）→ 合法，当空对象处理，不抛。
  if (raw.trim() === "") return {};

  // ② 有 body：解析失败就让原生 SyntaxError 原样抛出（不包 try/catch），
  //    其 message 形如 `Unexpected token { in JSON at position 0` / `Unexpected end of JSON input`，
  //    含 "JSON" 字样，正好命中 api-handler 里 D-011 的收窄判据 → 400 INVALID_JSON。
  const parsed: unknown = JSON.parse(raw);

  // ③ 合法 JSON 但不是「普通对象」：null / 数组 / 字符串 / 数字 → 422（不得当空 body）。
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UnprocessableEntityError("请求体必须是 JSON 对象");
  }

  return parsed as Record<string, any>;
}
