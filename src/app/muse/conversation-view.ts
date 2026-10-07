import type { Message } from "./types";

/** A mission can be cited by the plan and its report. Keep one live canvas per conversation. */
export function dedupeMissionCards(messages: Message[]): Message[] {
  const seen = new Set<string>();
  return messages.map(message => ({
    ...message,
    blocks: message.blocks.filter(block => {
      if (block.kind !== "mission") return true;
      if (seen.has(block.ref)) return false;
      seen.add(block.ref);
      return true;
    }),
  }));
}
