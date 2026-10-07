import { abortableDelay } from "@/shared/abort";
import { ModelRegistry } from "./registry";
import { ModelRoutingError, selectModelRoute } from "./router";
import {
  InMemoryModelHealthStore,
  ModelProviderError,
  classifyModelProviderFailure,
  resolveModelFailurePolicy,
  type ModelHealthStore,
} from "./health";
import type {
  ModelExecutionAttempt,
  ModelFailurePolicy,
  ModelGatewayRequest,
  ModelGatewayResult,
  ModelHealthSnapshot,
  ModelPolicy,
  ModelRouteSkip,
  ModelProfile,
} from "./types";

const RATE_LIMIT_BACKOFF_BASE_MS = 5_000;
const COOLDOWN_WAIT_MARGIN_MS = 50;

export class ModelGatewayExecutionError extends Error {
  constructor(
    message: string,
    public readonly attempts: ModelExecutionAttempt[],
    public readonly routingSkips: ModelRouteSkip[] = []
  ) {
    super(message);
    this.name = "ModelGatewayExecutionError";
  }
}

/**
 * Provider-agnostic execution with deterministic, policy-scoped fallback.
 *
 * It deliberately does not:
 * - choose policy by itself;
 * - mutate business data;
 * - silently switch to a model outside the policy candidate list;
 * - model-hop around content-policy / request-contract / configuration failures.
 */
export class ModelGateway {
  constructor(
    private readonly registry: ModelRegistry,
    private readonly healthStore: ModelHealthStore = new InMemoryModelHealthStore(),
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void> = abortableDelay,
    private readonly beforeProviderCall?: (profile: ModelProfile) => Promise<void>
  ) {}

  private async loadHealthSnapshots(): Promise<
    Map<string, ModelHealthSnapshot>
  > {
    const snapshots = new Map<string, ModelHealthSnapshot>();
    for (const profile of this.registry.listProfiles()) {
      const snapshot = await this.healthStore.get(profile.id);
      if (snapshot) snapshots.set(profile.id, snapshot);
    }
    return snapshots;
  }

  /**
   * KX-66：RATE_LIMIT 且策略内已没有其他可用候选时，返回在同一模型上重试前要等待的毫秒数；
   * 否则返回 null（照旧：有候选就 fallback，没有就冷却 + 失败）。
   * 只在预算内等待：服务端要求的 Retry-After 超出剩余预算时不重试，避免无意义地卡住调用方。
   */
  private async rateLimitRetryDelay(
    error: unknown,
    failurePolicy: ModelFailurePolicy,
    retriesSoFar: number,
    waitedMs: number,
    policy: ModelPolicy,
    request: ModelGatewayRequest,
    excluded: Set<string>
  ): Promise<number | null> {
    const maxRetries = failurePolicy.rateLimitRetries ?? 2;
    const budget = (failurePolicy.rateLimitMaxWaitMs ?? 20_000) - waitedMs;
    if (retriesSoFar >= maxRetries || budget <= 0) return null;

    try {
      selectModelRoute(
        policy,
        this.registry.listProfiles(),
        request,
        excluded,
        await this.loadHealthSnapshots(),
        this.now()
      );
      return null; // 还有其他候选：交给正常 fallback
    } catch (routeError) {
      if (!(routeError instanceof ModelRoutingError)) throw routeError;
    }

    const hinted = error instanceof ModelProviderError ? error.retryAfterMs : undefined;
    if (hinted !== undefined) return hinted <= budget ? hinted : null;
    return Math.min(RATE_LIMIT_BACKOFF_BASE_MS * 2 ** retriesSoFar, budget);
  }

  /**
   * KX-66：路由时所有候选都因「限流冷却」被跳过（通常是并发的另一个请求刚吃了 429），
   * 且最早的冷却在剩余等待预算内结束时，返回要等待的毫秒数；否则 null（照旧立即失败）。
   * 只认 RATE_LIMIT 冷却：鉴权失败、停用、缺能力、本次已尝试过等原因一律不等。
   */
  private async rateLimitCooldownWait(
    skipped: ModelRouteSkip[],
    failurePolicy: ModelFailurePolicy,
    waitedMs: number,
    excluded: Set<string>
  ): Promise<number | null> {
    if ((failurePolicy.rateLimitRetries ?? 2) === 0 || skipped.length === 0) return null;
    const budget = (failurePolicy.rateLimitMaxWaitMs ?? 20_000) - waitedMs;
    if (budget <= 0) return null;
    const now = this.now();
    let earliest = Number.POSITIVE_INFINITY;
    for (const skip of skipped) {
      if (excluded.has(skip.profileId)) return null;
      const snapshot = await this.healthStore.get(skip.profileId);
      if (
        !snapshot ||
        snapshot.lastFailureKind !== "RATE_LIMIT" ||
        snapshot.cooldownUntilMs == null ||
        snapshot.cooldownUntilMs <= now
      ) {
        return null;
      }
      earliest = Math.min(earliest, snapshot.cooldownUntilMs);
    }
    const wait = earliest - now + COOLDOWN_WAIT_MARGIN_MS;
    return wait <= budget ? wait : null;
  }

  async execute(
    policy: ModelPolicy,
    request: ModelGatewayRequest
  ): Promise<ModelGatewayResult> {
    const attempts: ModelExecutionAttempt[] = [];
    const routingSkips: ModelRouteSkip[] = [];
    const excluded = new Set<string>();
    const failurePolicy = resolveModelFailurePolicy(policy.failurePolicy);
    let rateLimitRetries = 0;
    let rateLimitWaitedMs = 0;

    while (true) {
      request.signal?.throwIfAborted();
      let route;
      try {
        route = selectModelRoute(
          policy,
          this.registry.listProfiles(),
          request,
          excluded,
          await this.loadHealthSnapshots(),
          this.now()
        );
        routingSkips.push(...route.skipped);
      } catch (error) {
        if (error instanceof ModelRoutingError) {
          const waitMs = await this.rateLimitCooldownWait(
            error.skipped,
            failurePolicy,
            rateLimitWaitedMs,
            excluded
          );
          if (waitMs !== null) {
            rateLimitWaitedMs += waitMs;
            await this.sleep(waitMs, request.signal);
            continue;
          }
          routingSkips.push(...error.skipped);
          throw new ModelGatewayExecutionError(
            attempts.length > 0
              ? `策略内所有可用模型均执行失败、处于冷却或不满足约束：${attempts.at(-1)?.error ?? "原因未知"}`
              : error.message,
            attempts,
            routingSkips
          );
        }
        throw error;
      }

      const profile = route.selected;
      excluded.add(profile.id);

      const provider = this.registry.getProvider(profile.provider);
      if (!provider) {
        const failure = classifyModelProviderFailure(
          new ModelProviderError(
            `未注册 provider 插件：${profile.provider}`,
            "CONFIG"
          )
        );
        attempts.push({
          profileId: profile.id,
          provider: profile.provider,
          modelId: profile.modelId,
          success: false,
          error: failure.message,
          failureKind: failure.kind,
          fallbackAllowed: failure.fallbackAllowed,
        });
        throw new ModelGatewayExecutionError(
          "ModelProfile 已启用但 provider 插件未注册；拒绝静默 fallback",
          attempts,
          routingSkips
        );
      }

      // Admission failures must escape without fallback or a health penalty.
      request.signal?.throwIfAborted();
      await request.beforeAttempt?.();
      request.signal?.throwIfAborted();
      await this.beforeProviderCall?.(profile);
      // Quota admission may wait on a transaction: recheck immediately before transport.
      request.signal?.throwIfAborted();
      await request.beforeAttempt?.();
      request.signal?.throwIfAborted();
      try {
        const result = await provider.execute(profile, request);
        request.signal?.throwIfAborted();
        await this.healthStore.recordSuccess(profile.id);
        attempts.push({
          profileId: profile.id,
          provider: profile.provider,
          modelId: result.modelId ?? profile.modelId,
          success: true,
        });
        return {
          ...result,
          profileId: profile.id,
          provider: profile.provider,
          resolvedModelId: result.modelId ?? profile.modelId,
          policyId: policy.id,
          policyVersion: policy.version,
          attempts,
          routingSkips,
        };
      } catch (error) {
        request.signal?.throwIfAborted();
        const failure = classifyModelProviderFailure(error);
        const retryDelayMs =
          failure.kind === "RATE_LIMIT"
            ? await this.rateLimitRetryDelay(
                error,
                failurePolicy,
                rateLimitRetries,
                rateLimitWaitedMs,
                policy,
                request,
                excluded
              )
            : null;
        if (retryDelayMs !== null) {
          attempts.push({
            profileId: profile.id,
            provider: profile.provider,
            modelId: profile.modelId,
            success: false,
            error: failure.message,
            failureKind: failure.kind,
            fallbackAllowed: failure.fallbackAllowed,
            retryDelayMs,
          });
          rateLimitRetries += 1;
          rateLimitWaitedMs += retryDelayMs;
          await this.sleep(retryDelayMs, request.signal);
          excluded.delete(profile.id); // 重新走路由：期间若被其他请求置为冷却，会如实失败
          continue;
        }

        await this.healthStore.recordFailure(
          profile.id,
          failure,
          failurePolicy
        );
        attempts.push({
          profileId: profile.id,
          provider: profile.provider,
          modelId: profile.modelId,
          success: false,
          error: failure.message,
          failureKind: failure.kind,
          fallbackAllowed: failure.fallbackAllowed,
        });

        if (!failure.fallbackAllowed) {
          throw new ModelGatewayExecutionError(
            `模型调用失败且禁止 fallback：${failure.kind}`,
            attempts,
            routingSkips
          );
        }
      }
    }
  }
}
