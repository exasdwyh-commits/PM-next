import { assertExecutorActive, ExecutionStoppedError, type ExecutorGuard } from "./claim";

/** Observe cancellation in another process without overlapping database polls. */
export function watchExecution(guard: ExecutorGuard) {
  const controller = new AbortController();
  let polling = false;
  let pending: Promise<void> = Promise.resolve();
  const assertActive = async () => { controller.signal.throwIfAborted(); await assertExecutorActive(guard); controller.signal.throwIfAborted(); };
  const timer = setInterval(() => {
    if (polling || controller.signal.aborted) return;
    polling = true;
    pending = assertActive().catch((error: unknown) => {
      // Only a confirmed stop revokes execution; transient DB faults are retried.
      // Admission checks still fail closed while the DB is unreachable.
      if (error instanceof ExecutionStoppedError) controller.abort(error);
    }).finally(() => { polling = false; });
  }, 750);
  timer.unref();
  return { signal: controller.signal, assertActive, dispose: async () => { clearInterval(timer); await pending; } };
}
