/** KX-70 提示词静态前缀基线的计算（被 tests/prompt-prefix.test.ts 与 scripts/arch-baseline.ts 共用）。 */
import crypto from "node:crypto";
import {
  DEPARTMENT_ASSISTANT_PERSONA_VERSION,
  buildDepartmentAssistantSystemPrompt,
} from "../../src/modules/assistant-runtime/persona";

export const PREFIX_TASK_CLASSES = ["ASSISTANT_DIALOGUE", "ASSISTANT_PLANNING", "ASSISTANT_SYNTHESIS"] as const;

export interface PrefixBaseline {
  note: string;
  version: string;
  hashes: Record<string, string>;
}

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

export function currentPrefixBaseline(): PrefixBaseline {
  const hashes: Record<string, string> = {};
  for (const tc of PREFIX_TASK_CLASSES) hashes[tc] = sha(buildDepartmentAssistantSystemPrompt(tc, null) ?? "");
  return {
    note: "KX-70 提示词静态前缀基线：前缀变了必须同时升 DEPARTMENT_ASSISTANT_PERSONA_VERSION，再运行 `npm run arch:baseline`。",
    version: DEPARTMENT_ASSISTANT_PERSONA_VERSION,
    hashes,
  };
}
