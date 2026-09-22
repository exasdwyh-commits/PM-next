import type {
  ModelFailureKind,
  ModelFailurePolicy,
  ModelHealthSnapshot,
} from "./types";

export const DEFAULT_MODEL_FAILURE_POLICY: ModelFailurePolicy = {
  failureThreshold: 2,
  cooldownMs: 60_000,
  rateLimitCooldownMs: 60_000,
  authCooldownMs: 15 * 60_000,
};

export class ModelProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: ModelFailureKind,
    public readonly status?: number
  ) {
    super(message);
    this.name = "ModelProviderError";
  }
}

export interface ClassifiedModelFailure {
  kind: ModelFailureKind;
  message: string;
  /** Whether trying another explicitly allowed policy candidate is permitted. */
  fallbackAllowed: boolean;
  /** Whether this failure should count toward provider health/cooldown. */
  affectsHealth: boolean;
}

export function classifyModelProviderFailure(
  error: unknown
): ClassifiedModelFailure {
  if (error instanceof ModelProviderError) {
    const kind = error.kind;
    return {
      kind,
      message: error.message,
      // Do not model-hop to evade content policy. BAD_REQUEST is a request
      // contract problem; sending the same request elsewhere hides the defect.
      fallbackAllowed:
        kind !== "CONTENT_POLICY" &&
        kind !== "BAD_REQUEST" &&
        kind !== "CONFIG",
      affectsHealth:
        kind !== "CONTENT_POLICY" &&
        kind !== "BAD_REQUEST" &&
        kind !== "CONFIG",
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: "UNKNOWN",
    message,
    fallbackAllowed: true,
    affectsHealth: true,
  };
}

export interface ModelHealthStore {
  get(profileId: string): Promise<ModelHealthSnapshot | null>;
  recordSuccess(profileId: string): Promise<ModelHealthSnapshot>;
  recordFailure(
    profileId: string,
    failure: ClassifiedModelFailure,
    policy: ModelFailurePolicy
  ): Promise<ModelHealthSnapshot>;
}

function normalizePolicy(
  policy: ModelFailurePolicy | undefined
): ModelFailurePolicy {
  const value = policy ?? DEFAULT_MODEL_FAILURE_POLICY;
  if (!Number.isInteger(value.failureThreshold) || value.failureThreshold < 1) {
    throw new Error("Model failureThreshold must be a positive integer");
  }
  if (!Number.isFinite(value.cooldownMs) || value.cooldownMs < 0) {
    throw new Error("Model cooldownMs must be a non-negative number");
  }
  if (
    value.rateLimitCooldownMs !== undefined &&
    (!Number.isFinite(value.rateLimitCooldownMs) ||
      value.rateLimitCooldownMs < 0)
  ) {
    throw new Error(
      "Model rateLimitCooldownMs must be a non-negative number"
    );
  }
  if (
    value.authCooldownMs !== undefined &&
    (!Number.isFinite(value.authCooldownMs) || value.authCooldownMs < 0)
  ) {
    throw new Error("Model authCooldownMs must be a non-negative number");
  }
  return value;
}

export function resolveModelFailurePolicy(
  policy: ModelFailurePolicy | undefined
): ModelFailurePolicy {
  return { ...normalizePolicy(policy) };
}

function cooldownForFailure(
  failure: ClassifiedModelFailure,
  policy: ModelFailurePolicy,
  failureCount: number
): number {
  if (!failure.affectsHealth) return 0;

  // Auth/rate-limit failures describe provider availability, not task quality.
  // They open immediately; transient/unknown failures need a streak.
  if (failure.kind === "AUTH") {
    return policy.authCooldownMs ?? Math.max(policy.cooldownMs, 15 * 60_000);
  }
  if (failure.kind === "RATE_LIMIT") {
    return policy.rateLimitCooldownMs ?? policy.cooldownMs;
  }

  return failureCount >= policy.failureThreshold ? policy.cooldownMs : 0;
}

/**
 * Process-local V1 implementation. The interface is async so a Postgres/Redis
 * store can replace it without changing ModelGateway.
 */
export class InMemoryModelHealthStore implements ModelHealthStore {
  private readonly state = new Map<string, ModelHealthSnapshot>();

  constructor(private readonly now: () => number = Date.now) {}

  async get(profileId: string): Promise<ModelHealthSnapshot | null> {
    const current = this.state.get(profileId);
    return current ? { ...current } : null;
  }

  async recordSuccess(profileId: string): Promise<ModelHealthSnapshot> {
    const previous = this.state.get(profileId);
    const next: ModelHealthSnapshot = {
      profileId,
      consecutiveFailures: 0,
      cooldownUntilMs: null,
      lastFailureKind: previous?.lastFailureKind ?? null,
      lastFailureAtMs: previous?.lastFailureAtMs ?? null,
      lastSuccessAtMs: this.now(),
      lastError: previous?.lastError ?? null,
    };
    this.state.set(profileId, next);
    return { ...next };
  }

  async recordFailure(
    profileId: string,
    failure: ClassifiedModelFailure,
    rawPolicy: ModelFailurePolicy
  ): Promise<ModelHealthSnapshot> {
    const policy = normalizePolicy(rawPolicy);
    const previous = this.state.get(profileId);
    const now = this.now();

    if (!failure.affectsHealth) {
      return previous
        ? { ...previous }
        : {
            profileId,
            consecutiveFailures: 0,
            cooldownUntilMs: null,
            lastFailureKind: null,
            lastFailureAtMs: null,
            lastSuccessAtMs: null,
            lastError: null,
          };
    }

    const failureCount = (previous?.consecutiveFailures ?? 0) + 1;
    const cooldownMs = cooldownForFailure(failure, policy, failureCount);
    const next: ModelHealthSnapshot = {
      profileId,
      consecutiveFailures: failureCount,
      cooldownUntilMs: cooldownMs > 0 ? now + cooldownMs : null,
      lastFailureKind: failure.kind,
      lastFailureAtMs: now,
      lastSuccessAtMs: previous?.lastSuccessAtMs ?? null,
      lastError: failure.message,
    };
    this.state.set(profileId, next);
    return { ...next };
  }
}

export function isModelCoolingDown(
  snapshot: ModelHealthSnapshot | null | undefined,
  nowMs: number
): boolean {
  return (
    snapshot?.cooldownUntilMs != null &&
    snapshot.cooldownUntilMs > nowMs
  );
}
