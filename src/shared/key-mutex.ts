/**
 * Per-key in-process async mutex.
 *
 * A Postgres advisory lock serializes writers across processes, but a
 * transaction that is *waiting* for one still occupies a pooled connection.
 * A burst of concurrent writers for the same key therefore drains the Prisma
 * connection pool, and the callers that never get a connection fail with
 * P2028 ("unable to start a transaction") instead of reaching their real
 * outcome — an honest quota refusal degrades into an opaque 500.
 *
 * Queueing in-process first keeps at most one in-flight transaction per key
 * per process, so the pool stays free and the advisory lock is only ever
 * contended between processes.
 *
 * Scope: this is a single-process primitive and is NOT a replacement for the
 * advisory lock. It only removes self-inflicted pool pressure.
 */

const chains = new Map<string, Promise<unknown>>();

export function withKeyLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  // Start once the previous holder settled, whether it resolved or rejected.
  const result = previous.then(run, run);
  // The chain itself must never reject, or every later waiter would inherit
  // an unrelated failure; `result` carries the real outcome to this caller.
  const tail = result.then(
    () => undefined,
    () => undefined
  );
  chains.set(key, tail);
  void tail.then(() => {
    // Drop the entry only if nobody queued behind us, so the map cannot grow
    // without bound across organizations.
    if (chains.get(key) === tail) chains.delete(key);
  });
  return result;
}
