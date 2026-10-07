/**
 * 常驻 Worker 的进程级并发预算（TASK-011）。
 *
 * 问题：此前 executor 与 conversation 各自串行取 limit 条执行，
 * 组织 A 的慢模型会阻塞整个循环，组织 B 的会话与任务全都推不动；
 * 两条队列还会各自吃满，把真实总上限翻倍。
 *
 * 方案：一份进程级预算同时约束两条队列的实际在途：
 *   - total          跨队列（conversation + executor）同时在途上限；
 *   - perOrganization 单组织同时在途上限。
 * 本预算是「本进程」的预算，不是多进程全局上限：多进程正确性仍由
 * 数据库 token / 会话锁 / Agent.maxConcurrentTasks 保证。
 *
 * 只接受正整数上限；NaN / 小数 / 负数 / 0 一律拒绝（F3）。
 */

export interface WorkLimits {
  total: number;
  perOrganization: number;
}

export interface WorkLimitInput {
  total?: unknown;
  perOrganization?: unknown;
}

const DEFAULT_TOTAL = 2;
const DEFAULT_PER_ORG = 1;

function toPositiveInt(value: unknown, name: string): number {
  // 只接受真正的 number：字符串/布尔/对象一律拒绝，转换只在 CLI 入口做一次，
  // 免得 "2"、""、null 在不同调用点被解释成不同的上限。
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new Error(`${name} 必须是正整数，收到 ${JSON.stringify(value) ?? String(value)}`);
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正整数，收到 ${value}（小数/负数/0 均拒绝）`);
  }
  return value;
}

/** 解析并校验并发参数；未提供的走默认。非法值抛错而不是静默用默认，否则配置错误会被掩盖。 */
export function resolveWorkLimits(input: WorkLimitInput = {}): WorkLimits {
  const total = input.total === undefined ? DEFAULT_TOTAL : toPositiveInt(input.total, "total");
  const perOrganization =
    input.perOrganization === undefined
      ? DEFAULT_PER_ORG
      : toPositiveInt(input.perOrganization, "perOrganization");
  return { total, perOrganization };
}

interface Slot {
  organizationId: string;
  released: boolean;
}

/** 取槽结果：`reason` 区分「总量满」与「该组织满」，两者对后续扫描的含义不同。 */
export type AcquireResult =
  | { ok: true; release: () => void }
  | { ok: false; reason: "total" | "organization" };

/** 进程级在途槽位账。 */
export class WorkBudget {
  private readonly limits: WorkLimits;
  private readonly inFlight = new Set<Slot>();
  private changeWaiters: Array<() => void> = [];

  constructor(limits: WorkLimits) {
    this.limits = { ...limits };
  }

  /** 当前在途总数。 */
  get totalInFlight(): number {
    return this.inFlight.size;
  }

  /** 指定组织当前在途。 */
  inFlightFor(organizationId: string): number {
    let n = 0;
    for (const slot of this.inFlight) if (slot.organizationId === organizationId) n += 1;
    return n;
  }

  /**
   * 能否再接一条这个组织的工作，**并说明为什么不能**。
   *
   * 两种「不能」对调度器的含义完全不同：
   *   - `total`：进程总容量已满 —— 继续扫描其他候选也只是白扫，应当停止本轮；
   *   - `organization`：只有这个组织超了自己的上限 —— 其他组织仍然合法，
   *     必须**跳过它继续找**，否则一个饱和组织会把整轮扫描废掉。
   */
  tryAcquireDetailed(organizationId: string): AcquireResult {
    if (this.inFlight.size >= this.limits.total) return { ok: false, reason: "total" };
    if (this.inFlightFor(organizationId) >= this.limits.perOrganization) {
      return { ok: false, reason: "organization" };
    }
    const slot: Slot = { organizationId, released: false };
    this.inFlight.add(slot);
    let done = false;
    const release = () => {
      if (done) return; // 幂等释放
      done = true;
      this.inFlight.delete(slot);
      this.notifyChange();
    };
    return { ok: true, release };
  }

  /** 只要槽位，拿不到就是 null（不区分原因）。 */
  tryAcquire(organizationId: string): (() => void) | null {
    const result = this.tryAcquireDetailed(organizationId);
    return result.ok ? result.release : null;
  }

  /** 有空位或容量变化时 resolve，供补给泵等待。 */
  async waitForChange(): Promise<void> {
    await new Promise<void>((resolve) => this.changeWaiters.push(resolve));
  }

  private notifyChange(): void {
    const waiters = this.changeWaiters;
    this.changeWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /** 供 CL1：单组织上限与恢复。 */
  stats(): { inFlight: number; byOrganization: Record<string, number> } {
    const byOrganization: Record<string, number> = {};
    for (const slot of this.inFlight) {
      byOrganization[slot.organizationId] = (byOrganization[slot.organizationId] ?? 0) + 1;
    }
    return { inFlight: this.inFlight.size, byOrganization };
  }
}

// ---------------------------------------------------------------------------
// 进程级单例 + 在途执行跟踪（drain）
// ---------------------------------------------------------------------------

let active: WorkBudget | null = null;
const inFlightPromises = new Set<Promise<unknown>>();

/** 配置（或重置）进程级预算。Worker 启动时调用一次。 */
export function configureWorkBudget(limits: WorkLimits): WorkBudget {
  active = new WorkBudget(limits);
  return active;
}

export function getWorkBudget(): WorkBudget {
  if (!active) active = new WorkBudget(resolveWorkLimits());
  return active;
}

export function resetWorkBudgetForTest(): void {
  active = null;
  inFlightPromises.clear();
}

/** 登记一条在途执行，供退出时 drain。promise 永远带错误处理，不遗留 rejection。 */
export function trackInFlight<T>(promise: Promise<T>): Promise<T> {
  let settled: Promise<unknown>;
  settled = promise.then(
    () => undefined,
    () => undefined
  );
  inFlightPromises.add(settled);
  void settled.finally(() => inFlightPromises.delete(settled)).catch(() => undefined);
  return promise;
}

/** 当前在途执行条数。 */
export function inFlightCount(): number {
  return inFlightPromises.size;
}

/** 等待所有已登记的在途执行收尾；不影响新执行。 */
export async function drainInFlight(): Promise<void> {
  while (inFlightPromises.size > 0) {
    const snapshot = [...inFlightPromises];
    await Promise.allSettled(snapshot);
  }
}

/** 取一个槽位执行 fn；取不到返回 null（不区分原因）。 */
export async function withWorkSlot<T>(
  organizationId: string,
  fn: () => Promise<T>
): Promise<{ ran: true; value: T } | { ran: false }> {
  const release = getWorkBudget().tryAcquire(organizationId);
  if (!release) return { ran: false };
  try {
    return { ran: true, value: await fn() };
  } finally {
    release();
  }
}

/** 启动结果的原因：调用方据此决定「停止扫描」还是「跳过这个组织继续找」。 */
export type LaunchSkipReason = "total" | "organization" | "admission-closed";

export interface LaunchResult {
  launched: boolean;
  reason?: LaunchSkipReason;
}

/**
 * 在预算内启动一条工作，并登记为在途执行 —— **会话与 executor 共用的唯一入口**。
 *
 * 为什么要共用：这两条队列曾各自实现过一遍「取槽位 / 容量满就停 / 组织饱和就跳过 /
 * 跟踪 promise / 归还槽位」，结果是同一类缺陷被独立发现并各修一次
 * （组织饱和阻塞补位、停止后仍领取）。语义只有一份，才不会再各自漂移。
 *
 * - 总容量满 → `launched: false, reason: "total"`，调用方停止扫描本轮；
 * - 该组织饱和 → `launched: false, reason: "organization"`，调用方跳过它继续找别的组织；
 * - 准入已关闭 → `launched: false, reason: "admission-closed"`，同样停止扫描；
 * - 已启动 → promise 一定被 `trackInFlight` 跟踪，槽位在 `finally` 里归还。
 */
export async function launchWithBudget(input: {
  organizationId: string;
  admission?: () => boolean;
  run: (admission: (() => boolean) | undefined) => Promise<unknown>;
  onError?: (error: unknown) => void;
}): Promise<LaunchResult> {
  if (input.admission && !input.admission()) {
    return { launched: false, reason: "admission-closed" };
  }
  const slot = getWorkBudget().tryAcquireDetailed(input.organizationId);
  if (!slot.ok) return { launched: false, reason: slot.reason };
  const { release } = slot;
  const work = (async () => {
    try {
      await input.run(input.admission);
    } finally {
      release();
    }
  })();
  trackInFlight(work);
  if (input.onError) {
    work.catch((error: unknown) => input.onError!(error));
  }
  return { launched: true };
}
