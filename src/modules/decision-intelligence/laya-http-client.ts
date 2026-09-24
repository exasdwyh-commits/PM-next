import type {
  LayaDecisionClient,
} from "./laya-engine";
import type { DecisionSpec, DecisionValue } from "./types";

export interface LayaDecisionRequest {
  decisionKey: string;
  outputType: DecisionSpec["outputType"];
  allowedChoices?: string[];
  minScore?: number;
  maxScore?: number;
  state: unknown;
  criteria?: unknown;
  language?: string;
}

export interface LayaDecisionResult {
  value: DecisionValue;
  confidence: number | null;
  distribution: Record<string, number> | null;
  reasonCodes: string[];
  latencyMs: number;
  calibrated: boolean;
  calibrationProfile: string | null;
  benchmarkProfile: string | null;
}

interface LayaHttpConfig {
  baseUrl: string;
  apiKey: string | null;
  timeoutMs: number;
  model: string | null;
}

const INSTRUCTIONS: Record<string, string> = {
  "assistant.intent":
    "Classify the user's immediate request by the primary action the Department Assistant should take.",
  "assistant.complexity":
    "Estimate execution complexity, considering number of steps, specialist depth, verification and coordination required.",
  "assistant.requires_research":
    "Decide whether this request requires fresh external research rather than only existing conversation/company context.",
  "assistant.expert_class":
    "Choose the primary specialist class that should be consulted. Choose NONE when the Department Assistant can handle it directly.",
  "assistant.proactive_value":
    "Score how useful it would be for the Department Assistant to proactively continue this work, from 0 no useful follow-up to 9 high-value urgent follow-up.",
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

export function resolveLayaHttpConfig(): LayaHttpConfig | null {
  const raw = process.env.LAYA_BASE_URL?.trim();
  if (!raw) return null;
  const url = new URL(raw);
  const allowRemote = /^(1|true|yes|on)$/i.test(process.env.LAYA_ALLOW_REMOTE ?? "");
  if (!allowRemote && !isLoopbackHost(url.hostname)) {
    throw new Error("Remote Laya endpoint is disabled; set LAYA_ALLOW_REMOTE=true only with an approved data policy");
  }
  return {
    baseUrl: raw.replace(/\/+$/, ""),
    apiKey: process.env.LAYA_API_KEY?.trim() || null,
    timeoutMs: parsePositiveInt(process.env.LAYA_TIMEOUT_MS, 1500),
    model: process.env.LAYA_MODEL?.trim() || "typed-decisions",
  };
}

function questionFor(input: LayaDecisionRequest): Record<string, unknown> {
  const instructions =
    INSTRUCTIONS[input.decisionKey] ??
    `Return the bounded typed decision for ${input.decisionKey}.`;

  if (input.outputType === "CHOICE") {
    const choices = input.allowedChoices ?? [];
    if (!choices.length) throw new Error("Laya choice decision requires allowedChoices");
    return {
      type: "choice",
      instructions,
      criteria: Object.fromEntries(choices.map((choice) => [choice, choice])),
    };
  }
  if (input.outputType === "BOOLEAN") {
    return {
      type: "noul",
      instructions,
      criteria: {
        false: "No / false",
        true: "Yes / true",
      },
    };
  }
  const min = input.minScore ?? 0;
  const max = input.maxScore ?? 9;
  const levels = max - min + 1;
  if (levels < 2 || levels > 10) {
    throw new Error("Laya score decisions require 2-10 discrete levels");
  }
  return {
    type: "score",
    instructions,
    criteria: Array.from({ length: levels }, (_, index) =>
      String(min + index)
    ),
  };
}

function numberMap(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rows = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number"
  );
  return rows.length ? Object.fromEntries(rows) : null;
}

function parseAnswer(
  request: LayaDecisionRequest,
  raw: unknown,
  latencyMs: number,
  model: unknown
): LayaDecisionResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Laya response missing answer for ${request.decisionKey}`);
  }
  const answer = raw as Record<string, unknown>;
  let value: DecisionValue;
  let distribution = numberMap(answer.probabilities);
  let confidence =
    typeof answer.confidence === "number" ? answer.confidence : null;

  if (request.outputType === "CHOICE") {
    if (typeof answer.choice !== "string") throw new Error("Laya choice answer missing choice");
    value = answer.choice;
  } else if (request.outputType === "BOOLEAN") {
    if (typeof answer.noul !== "number") throw new Error("Laya boolean answer missing noul probability");
    value = answer.noul >= 0.5;
    distribution = {
      false: 1 - answer.noul,
      true: answer.noul,
    };
    if (confidence === null) confidence = Math.abs(answer.noul - 0.5) * 2;
  } else {
    if (typeof answer.score !== "number") throw new Error("Laya score answer missing score");
    value = answer.score + (request.minScore ?? 0);
  }

  if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    confidence = null;
  }

  return {
    value,
    confidence,
    distribution,
    reasonCodes: [
      "LAYA_SYSTEM1_HTTP",
      ...(typeof model === "string" ? [`LAYA_MODEL:${model}`] : []),
    ],
    latencyMs,
    // Model-level calibration does not establish workload-specific calibration.
    calibrated: false,
    calibrationProfile: null,
    benchmarkProfile: null,
  };
}

export class LayaHttpDecisionClient implements LayaDecisionClient {
  constructor(private readonly config: LayaHttpConfig) {}

  async decide(input: LayaDecisionRequest): Promise<LayaDecisionResult> {
    const results = await this.decideMany([input]);
    return results.get(input.decisionKey)!;
  }

  async decideMany(
    requests: LayaDecisionRequest[]
  ): Promise<Map<string, LayaDecisionResult>> {
    if (!requests.length) return new Map();
    const firstState = requests[0].state;
    if (requests.some((request) => JSON.stringify(request.state) !== JSON.stringify(firstState))) {
      throw new Error("Laya batched reflex decisions must share one state");
    }

    const questions = Object.fromEntries(
      requests.map((request) => [request.decisionKey, questionFor(request)])
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const started = performance.now();
    try {
      const response = await fetch(`${this.config.baseUrl}/v1/systemone`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.config.apiKey
            ? { authorization: `Bearer ${this.config.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          state: firstState,
          questions,
          ...(this.config.model ? { model: this.config.model } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `Laya HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ""}`
        );
      }
      const payload = (await response.json()) as Record<string, unknown>;
      const answers =
        payload.answers && typeof payload.answers === "object" && !Array.isArray(payload.answers)
          ? (payload.answers as Record<string, unknown>)
          : {};
      const elapsed = performance.now() - started;
      const out = new Map<string, LayaDecisionResult>();
      for (const request of requests) {
        out.set(
          request.decisionKey,
          parseAnswer(request, answers[request.decisionKey], elapsed, payload.model)
        );
      }
      return out;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Laya request timed out after ${this.config.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createLayaHttpDecisionClientFromEnv(): LayaHttpDecisionClient | null {
  const config = resolveLayaHttpConfig();
  return config ? new LayaHttpDecisionClient(config) : null;
}
