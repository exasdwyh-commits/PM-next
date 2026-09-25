/**
 * Hermes Desktop Runtime 在线状态。
 *
 * 为什么需要它：advisor 把「本机执行」排进队列后，以前无论 Mac 上的 runtime 是否在跑，
 * 回复都是「已发送到你的 Mac 执行队列」。runtime 没启动时任务会永远停在 QUEUED，
 * 而用户以为 Hermes 正在执行 —— 这正是交付诚实规则禁止的「假执行」。
 *
 * 心跳来源是既有的取任务轮询（GET /api/desktop-runtime/tasks?deviceId=…），
 * 不需要新增端点，也不需要新增数据表：presence 是瞬时运行状态，不是业务事实，
 * 落库反而会在进程重启后留下「看起来在线」的过期记录。
 *
 * 代价（如实记录，不要假装没有）：状态保存在 Next 进程内存里。
 * - 进程重启后回到 unknown，直到 runtime 下一次轮询（默认几秒）。
 * - 多实例部署时每个实例只知道打到自己身上的轮询。
 * PM-next 的目标形态是跑在用户 Mac 上的单进程应用，这两点都可接受；
 * unknown 一律如实呈现为「未确认」，绝不当成在线。
 */

/** 超过这个时长没有轮询就不再算在线。runtime 默认轮询间隔远小于它。 */
export const DESKTOP_ONLINE_WINDOW_MS = 45_000;

/** 超过这个时长没有轮询，视为已断开而不只是延迟。 */
export const DESKTOP_STALE_WINDOW_MS = 10 * 60_000;

export type DesktopPresenceStatus = "ONLINE" | "STALE" | "UNKNOWN";

export interface DesktopPresence {
  status: DesktopPresenceStatus;
  /** 最近一次轮询的设备标识；UNKNOWN 时为 null。 */
  deviceId: string | null;
  /** 最近一次轮询时间；UNKNOWN 时为 null。 */
  lastSeenAt: string | null;
  /** 距最近一次轮询的秒数；UNKNOWN 时为 null。 */
  secondsSinceLastSeen: number | null;
  /** 面向用户的一句话状态，措辞必须与真实状态一致。 */
  label: string;
  /** 用户此刻该做什么；已在线时为 null。 */
  hint: string | null;
}

interface PresenceRecord {
  deviceId: string;
  lastSeenAt: number;
}

/**
 * key = `${organizationId}:${userId}`：队列本身就是按「组织 + 本人」隔离的。
 *
 * 挂在 globalThis 上，和 prisma 单例同一个理由：Next 会把不同 route handler 打进
 * 不同的 bundle，模块级 Map 会被复制成多份。实测过的后果是 runtime 明明刚轮询过
 * （心跳写进了 tasks 路由那一份），overview 路由读到的却是空表，于是界面一直显示
 * 「未确认」—— 状态是真的，只是读错了一份内存，用户会以为 Mac 没连上。
 */
const globalForPresence = globalThis as unknown as {
  __hermesDesktopPresence?: Map<string, PresenceRecord>;
};
const registry: Map<string, PresenceRecord> =
  globalForPresence.__hermesDesktopPresence ??
  (globalForPresence.__hermesDesktopPresence = new Map<string, PresenceRecord>());

function keyOf(organizationId: string, userId: string): string {
  return `${organizationId}:${userId}`;
}

/** runtime 轮询取任务时调用。这是唯一的心跳写入点。 */
export function noteDesktopPresence(input: {
  organizationId: string;
  userId: string;
  deviceId: string;
}): void {
  const deviceId = input.deviceId.trim();
  if (!deviceId) return;
  registry.set(keyOf(input.organizationId, input.userId), {
    deviceId,
    lastSeenAt: Date.now(),
  });
}

export function readDesktopPresence(input: {
  organizationId: string;
  userId: string;
  now?: number;
}): DesktopPresence {
  const now = input.now ?? Date.now();
  const record = registry.get(keyOf(input.organizationId, input.userId));

  if (!record) {
    return {
      status: "UNKNOWN",
      deviceId: null,
      lastSeenAt: null,
      secondsSinceLastSeen: null,
      label: "本机连接未确认",
      hint: "Kern 还没有检测到你的 Mac。请启动 Kern 本机执行；开发环境可运行 npm run desktop。连接后这里会显示设备名。",
    };
  }

  const elapsed = Math.max(0, now - record.lastSeenAt);
  const seconds = Math.round(elapsed / 1000);
  const lastSeenAt = new Date(record.lastSeenAt).toISOString();

  if (elapsed <= DESKTOP_ONLINE_WINDOW_MS) {
    return {
      status: "ONLINE",
      deviceId: record.deviceId,
      lastSeenAt,
      secondsSinceLastSeen: seconds,
      label: `本机已连接 · ${record.deviceId}`,
      hint: null,
    };
  }

  return {
    status: "STALE",
    deviceId: record.deviceId,
    lastSeenAt,
    secondsSinceLastSeen: seconds,
    label:
      elapsed >= DESKTOP_STALE_WINDOW_MS
        ? `本机已断开 · ${record.deviceId}`
        : `本机连接不稳定 · ${record.deviceId}`,
    hint: "排队的本机任务要等 Kern 重新连上这台 Mac 才会执行。开发环境请确认 npm run desktop 仍在运行。",
  };
}

/** 仅测试用：清空注册表，避免用例之间互相污染。 */
export function __resetDesktopPresenceForTest(): void {
  registry.clear();
}
