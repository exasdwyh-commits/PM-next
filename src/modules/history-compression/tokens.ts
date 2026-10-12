/**
 * token 用量估算（启发式，非计费口径）。
 *
 * 用途：C3 上下文压缩的「旧方式 vs 新方式」对比证据，以及提示词预算的粗略规划。
 * 绝不能用于向用户报价或与 provider 对账——真实用量以各 provider 返回的 usage 为准。
 *
 * 权重取法（公开、可复核）：
 * - ASCII 可见字符/空白：0.25 token/字符（英文约 4 字符 1 token 的常用近似）；
 * - 中日韩表意文字（CJK 统一表意、假名、谚文、标点区）：1.5 token/字符；
 * - 其余字符（emoji、特殊符号等）：0.5 token/字符。
 * 每条消息另加 4 token 的角色/结构开销（对齐 OpenAI 系的估算惯例）。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let total = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 128) {
      total += 0.25;
    } else if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意
      (code >= 0x3400 && code <= 0x4dbf) || // CJK 扩展 A
      (code >= 0x20000 && code <= 0x2a6df) || // CJK 扩展 B
      (code >= 0x3040 && code <= 0x30ff) || // 平假名/片假名
      (code >= 0xac00 && code <= 0xd7af) || // 谚文
      (code >= 0x3000 && code <= 0x303f) // CJK 符号和标点
    ) {
      total += 1.5;
    } else {
      total += 0.5;
    }
  }
  return Math.ceil(total);
}

export function estimateMessagesTokens(
  messages: { role: string; content: string }[]
): number {
  let total = 0;
  for (const m of messages) {
    total += 4; // 每条消息的结构开销
    total += estimateTokens(m.content);
  }
  return total;
}
