/**
 * Shared text rules — the single source for "how Kern must not sound".
 *
 * Both reply layers use these:
 * - daily chat Markdown  → src/modules/assistant-runtime/reply-format.ts (normalize + lint)
 * - mission envelope     → src/modules/response-format/validate.ts (R9 / R12 / R15)
 *
 * Pure, dependency-free and isomorphic so the Node harness and the browser
 * renderer can never disagree.
 */

/** AI 套话黑名单。Kern 是同事，不是客服机器人。 */
export const BANNED_PHRASES =
  /作为一个\s*AI|作为一名\s*AI|我只是一个|我无法提供|希望[^。！？\n]{0,10}帮助|如有(任何)?疑问，?请随时|总的来说，我建议您/;

/** 客套开头：「好的！我来为你…：」这类没有信息量的起句。 */
export const PREAMBLE =
  /^(?:好的|好|当然|没问题|收到|明白了?|可以的?|OK|Sure|Certainly|Of course|Great question)[！!，,。.、~\s]+(?:(?:我(?:来|将|会)|下面|以下|这是)[^\n。！!：:]{0,24}[：:]\s*)?/i;

const EMOJI = /\p{Extended_Pictographic}/u;
/** Typographic symbols that are allowed even though Unicode lists some as pictographic. */
const ALLOWED_SYMBOLS = /[✓✔✗✘→←↑↓©®™]/g;

export function hasEmoji(text: string): boolean {
  return EMOJI.test(text.replace(ALLOWED_SYMBOLS, ""));
}

export function findBannedPhrase(text: string): string | null {
  return BANNED_PHRASES.exec(text)?.[0] ?? null;
}

export function startsWithPreamble(text: string): boolean {
  return PREAMBLE.test(text.trimStart());
}
