export type LayaQuestionDefinition =
  | {
      type: "noul";
      instructions: string;
    }
  | {
      type: "choice";
      instructions: string;
      criteria: Record<string, string | null>;
    };

export interface LayaRuntimeEvaluateRequest {
  state: unknown;
  questions: Record<string, LayaQuestionDefinition>;
  model?: string;
  task?: string;
  lang?: string;
}

export interface LayaChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
  action?: { act_probability?: number };
}

export interface LayaNoulAnswer {
  type: "noul";
  noul: number;
  confidence: number;
  action?: { act_probability?: number };
}

export type LayaRuntimeAnswer = LayaChoiceAnswer | LayaNoulAnswer;

export interface LayaRuntimeEvaluateResponse {
  model: string;
  answers: Record<string, LayaRuntimeAnswer>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  routing?: {
    model?: string;
    repo?: string;
    reason?: string;
    [key: string]: unknown;
  };
  runtime?: JudgmentRuntimeHealth;
}

export interface JudgmentRuntimeHealth {
  status: "ok" | "degraded";
  serviceVersion: string;
  provider: string;
  providerVersion: string | null;
  loadedModels: string[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite01(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

export function parseLayaRuntimeEvaluateResponse(
  value: unknown
): LayaRuntimeEvaluateResponse {
  const root = record(value);
  if (!root || typeof root.model !== "string") {
    throw new Error("Invalid Laya runtime response: model is required");
  }
  const rawAnswers = record(root.answers);
  if (!rawAnswers) {
    throw new Error("Invalid Laya runtime response: answers are required");
  }

  const answers: Record<string, LayaRuntimeAnswer> = {};
  for (const [key, raw] of Object.entries(rawAnswers)) {
    const answer = record(raw);
    if (!answer || typeof answer.type !== "string") {
      throw new Error(`Invalid Laya answer for ${key}`);
    }

    if (answer.type === "choice") {
      const probabilities = record(answer.probabilities);
      if (
        typeof answer.choice !== "string" ||
        !finite01(answer.confidence) ||
        !probabilities
      ) {
        throw new Error(`Invalid Laya choice answer for ${key}`);
      }
      const parsedProbabilities: Record<string, number> = {};
      for (const [option, probability] of Object.entries(probabilities)) {
        if (!finite01(probability)) {
          throw new Error(`Invalid Laya probability for ${key}:${option}`);
        }
        parsedProbabilities[option] = probability;
      }
      if (!(answer.choice in parsedProbabilities)) {
        throw new Error(
          `Invalid Laya choice answer for ${key}: selected choice missing from probabilities`
        );
      }
      answers[key] = {
        type: "choice",
        choice: answer.choice,
        probabilities: parsedProbabilities,
        confidence: answer.confidence,
      };
      continue;
    }

    if (answer.type === "noul") {
      if (!finite01(answer.noul) || !finite01(answer.confidence)) {
        throw new Error(`Invalid Laya noul answer for ${key}`);
      }
      answers[key] = {
        type: "noul",
        noul: answer.noul,
        confidence: answer.confidence,
      };
      continue;
    }

    throw new Error(`Unsupported Laya answer type for ${key}: ${answer.type}`);
  }

  const runtime =
    root.runtime === undefined
      ? undefined
      : parseJudgmentRuntimeHealth(root.runtime);

  return {
    model: root.model,
    answers,
    usage: record(root.usage) as LayaRuntimeEvaluateResponse["usage"],
    routing: record(root.routing) as LayaRuntimeEvaluateResponse["routing"],
    runtime,
  };
}

export function parseJudgmentRuntimeHealth(
  value: unknown
): JudgmentRuntimeHealth {
  const root = record(value);
  if (
    !root ||
    (root.status !== "ok" && root.status !== "degraded") ||
    typeof root.serviceVersion !== "string" ||
    typeof root.provider !== "string" ||
    !(typeof root.providerVersion === "string" || root.providerVersion === null) ||
    !Array.isArray(root.loadedModels) ||
    !root.loadedModels.every((item) => typeof item === "string")
  ) {
    throw new Error("Invalid Judgment Runtime health response");
  }
  return {
    status: root.status,
    serviceVersion: root.serviceVersion,
    provider: root.provider,
    providerVersion: root.providerVersion,
    loadedModels: [...root.loadedModels],
  };
}
