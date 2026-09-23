import type { DecisionRequest, DecisionSpec } from "../types";
import {
  parseJudgmentRuntimeHealth,
  parseLayaRuntimeEvaluateResponse,
  type JudgmentRuntimeHealth,
  type LayaQuestionDefinition,
  type LayaRuntimeEvaluateRequest,
} from "../runtime-contract";
import type {
  JudgmentProvider,
  JudgmentProviderDecision,
} from "./types";

export interface LayaJudgmentProviderOptions {
  endpoint: string;
  key?: string;
  version?: string;
  timeoutMs?: number;
  maxConsecutiveFailures?: number;
  cooldownMs?: number;
  model?: string;
  task?: string;
  calibrationProfile?: string | null;
  benchmarkProfile?: string | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function trimEndpoint(endpoint: string): string {
  const value = endpoint.trim().replace(/\/+$/, "");
  if (!value) throw new Error("Laya runtime endpoint is required");
  return value;
}

function criteriaDescriptions(
  request: DecisionRequest,
  choices: string[]
): Record<string, string | null> {
  const criteria =
    request.criteria &&
    typeof request.criteria === "object" &&
    !Array.isArray(request.criteria)
      ? (request.criteria as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    choices.map((choice) => [
      choice,
      typeof criteria[choice] === "string" ? String(criteria[choice]) : choice,
    ])
  );
}

function questionFor(
  spec: DecisionSpec,
  request: DecisionRequest
): LayaQuestionDefinition {
  const instructions =
    spec.description?.trim() ||
    `Evaluate Hermes decision ${spec.key}@${spec.version}`;

  if (spec.outputType === "BOOLEAN") {
    return { type: "noul", instructions };
  }

  if (spec.outputType === "CHOICE" && spec.allowedChoices?.length) {
    return {
      type: "choice",
      instructions,
      criteria: criteriaDescriptions(request, spec.allowedChoices),
    };
  }

  throw new Error(
    `Laya shadow provider does not support ${spec.outputType} for ${spec.key}@${spec.version}`
  );
}

function perRunProviderVersion(
  response: {
    model: string;
    routing?: { model?: string };
    runtime?: { providerVersion: string | null };
  }
): string | undefined {
  const version = response.runtime?.providerVersion?.trim();
  const checkpoint = response.routing?.model?.trim() || response.model.trim();
  if (!version || !checkpoint) return undefined;
  return `laya@${version}/${checkpoint}`;
}

function routeReasonCode(model: unknown): string | null {
  if (typeof model !== "string" || !model.trim()) return null;
  return (
    "LAYA_ROUTE_" +
    model
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
  );
}

export class LayaJudgmentProvider implements JudgmentProvider {
  readonly kind = "MODEL" as const;
  readonly key: string;
  readonly version: string;

  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxConsecutiveFailures: number;
  private readonly cooldownMs: number;
  private readonly model?: string;
  private readonly task?: string;
  private readonly calibrationProfile: string | null;
  private readonly benchmarkProfile: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  private consecutiveFailures = 0;
  private cooldownUntil = 0;

  constructor(options: LayaJudgmentProviderOptions) {
    this.endpoint = trimEndpoint(options.endpoint);
    this.key = options.key ?? "laya-shadow";
    this.version = options.version ?? "laya-runtime/v1";
    this.timeoutMs = Math.max(100, options.timeoutMs ?? 2500);
    this.maxConsecutiveFailures = Math.max(
      1,
      options.maxConsecutiveFailures ?? 3
    );
    this.cooldownMs = Math.max(1000, options.cooldownMs ?? 30_000);
    this.model = options.model;
    this.task = options.task;
    this.calibrationProfile = options.calibrationProfile ?? null;
    this.benchmarkProfile = options.benchmarkProfile ?? null;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  canHandle(spec: DecisionSpec): boolean {
    return (
      spec.outputType === "BOOLEAN" ||
      (spec.outputType === "CHOICE" && Boolean(spec.allowedChoices?.length))
    );
  }

  isCircuitOpen(): boolean {
    return this.now() < this.cooldownUntil;
  }

  async health(): Promise<JudgmentRuntimeHealth> {
    return this.getJson<JudgmentRuntimeHealth>(
      "/health",
      undefined,
      parseJudgmentRuntimeHealth
    );
  }

  async evaluate(
    spec: DecisionSpec,
    request: DecisionRequest
  ): Promise<JudgmentProviderDecision> {
    if (this.isCircuitOpen()) {
      throw new Error("Laya judgment runtime circuit is open");
    }

    const questionId = "decision";
    const payload: LayaRuntimeEvaluateRequest = {
      state: request.state,
      questions: {
        [questionId]: questionFor(spec, request),
      },
      ...(this.model ? { model: this.model } : {}),
      ...(this.task ? { task: this.task } : {}),
      ...(request.language ? { lang: request.language } : {}),
    };

    try {
      const response = await this.getJson(
        "/evaluate",
        payload,
        parseLayaRuntimeEvaluateResponse
      );
      const answer = response.answers[questionId];
      if (!answer) throw new Error("Laya runtime omitted decision answer");

      const reasonCodes = ["LAYA_SHADOW"];
      const providerVersion = perRunProviderVersion(response);
      const routeCode = routeReasonCode(response.routing?.model);
      if (routeCode) reasonCodes.push(routeCode);

      this.consecutiveFailures = 0;
      this.cooldownUntil = 0;

      if (answer.type === "noul") {
        return {
          value: answer.noul >= 0.5,
          providerVersion,
          confidence: answer.confidence,
          distribution: {
            false: 1 - answer.noul,
            true: answer.noul,
          },
          reasonCodes,
          calibrated: Boolean(this.calibrationProfile),
          calibrationProfile: this.calibrationProfile,
          benchmarkProfile: this.benchmarkProfile,
          abstained: false,
        };
      }

      return {
        value: answer.choice,
        providerVersion,
        confidence: answer.confidence,
        distribution: { ...answer.probabilities },
        reasonCodes,
        calibrated: Boolean(this.calibrationProfile),
        calibrationProfile: this.calibrationProfile,
        benchmarkProfile: this.benchmarkProfile,
        abstained: false,
      };
    } catch (error) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        this.cooldownUntil = this.now() + this.cooldownMs;
      }
      throw error;
    }
  }

  private async getJson<T>(
    path: string,
    body: unknown,
    parse: (value: unknown) => T
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint + path, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `Laya runtime request failed: HTTP ${response.status}`
        );
      }
      return parse(await response.json());
    } finally {
      clearTimeout(timer);
    }
  }
}
