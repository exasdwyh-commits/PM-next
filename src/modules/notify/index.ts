/**
 * KX-33 · 通知渠道扩展点（仅接口占位，不接任何真实系统）
 * =====================================================
 * - 用户决定（2026-09-29）：暂不接飞书，只预留扩展点。
 * - 内置渠道 inbox：消息本来就在应用内可见，这里只登记“已送达应用内”。
 * - 外部渠道（飞书 / 企业微信 / 邮件 / Webhook）目前只是保留名额，未注册任何实现。
 *   以后接入时实现 NotifyChannel 并调用 registerNotifyChannel 即可。
 * - 外部发送属于受保护能力 external.send（与 KX-31 连接器写工具一致），
 *   没有审批凭据一律不发；dispatch 永不抛错，逐渠道返回结果。
 */
import { WRITE_CAPABILITY } from "../connectors/policy";

export type NotifyLevel = "info" | "attention" | "blocked";

export type NotifyMessage = {
  title: string;
  body: string;
  level: NotifyLevel;
  /** 应用内跳转路径（相对 URL），例如 /muse?c=xxx */
  link?: string;
};

export type NotifyChannelKind = "builtin" | "external";

export type NotifyResult = {
  channel: string;
  status: "sent" | "skipped" | "needs_approval" | "failed";
  detail?: string;
};

export interface NotifyChannel {
  id: string;
  label: string;
  kind: NotifyChannelKind;
  /** 外部渠道：是否已配置好（凭据、地址等）。未配置时 dispatch 跳过。 */
  isConfigured(): boolean;
  send(msg: NotifyMessage): Promise<void>;
}

/** 预留的外部渠道名额：只用于展示“以后可接”，不代表已实现。 */
export const RESERVED_CHANNELS = [
  { id: "feishu", label: "飞书" },
  { id: "wecom", label: "企业微信" },
  { id: "email", label: "邮件" },
  { id: "webhook", label: "Webhook" },
] as const;

export const NOTIFY_EXTERNAL_CAPABILITY = WRITE_CAPABILITY;
export const MAX_TITLE = 120;
export const MAX_BODY = 2000;

const inboxChannel: NotifyChannel = {
  id: "inbox",
  label: "应用内",
  kind: "builtin",
  isConfigured: () => true,
  send: async () => {},
};

const registry = new Map<string, NotifyChannel>([[inboxChannel.id, inboxChannel]]);

export function registerNotifyChannel(ch: NotifyChannel): void {
  if (ch.id === inboxChannel.id) throw new Error("inbox 是内置渠道，不能覆盖");
  if (ch.kind !== "external") throw new Error("只能注册外部渠道");
  registry.set(ch.id, ch);
}

export function unregisterNotifyChannelForTest(id: string): void {
  if (id !== inboxChannel.id) registry.delete(id);
}

export type NotifyChannelView = {
  id: string;
  label: string;
  kind: NotifyChannelKind;
  state: "active" | "unconfigured" | "reserved";
};

export function listNotifyChannels(): NotifyChannelView[] {
  const out: NotifyChannelView[] = [...registry.values()].map((c) => ({
    id: c.id,
    label: c.label,
    kind: c.kind,
    state: c.isConfigured() ? "active" : "unconfigured",
  }));
  for (const r of RESERVED_CHANNELS) {
    if (!registry.has(r.id)) out.push({ id: r.id, label: r.label, kind: "external", state: "reserved" });
  }
  return out;
}

export function normalizeMessage(msg: NotifyMessage): NotifyMessage {
  const clean = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);
  const link = msg.link && msg.link.startsWith("/") && !msg.link.startsWith("//") ? msg.link : undefined;
  return { title: clean(msg.title, MAX_TITLE), body: msg.body.trim().slice(0, MAX_BODY), level: msg.level, link };
}

/**
 * 发送一条通知。
 * - channels 省略时只发内置 inbox；外部渠道必须显式点名。
 * - approvedExternal：调用方已拿到 external.send 审批凭据时才为 true。
 */
export async function dispatchNotification(
  msg: NotifyMessage,
  opts: { channels?: string[]; approvedExternal?: boolean } = {},
): Promise<NotifyResult[]> {
  const m = normalizeMessage(msg);
  const ids = opts.channels?.length ? [...new Set(opts.channels)] : [inboxChannel.id];
  const results: NotifyResult[] = [];
  for (const id of ids) {
    const ch = registry.get(id);
    if (!ch) {
      const reserved = RESERVED_CHANNELS.some((r) => r.id === id);
      results.push({ channel: id, status: "skipped", detail: reserved ? "reserved" : "unknown" });
      continue;
    }
    if (ch.kind === "external" && !ch.isConfigured()) {
      results.push({ channel: id, status: "skipped", detail: "unconfigured" });
      continue;
    }
    if (ch.kind === "external" && opts.approvedExternal !== true) {
      results.push({ channel: id, status: "needs_approval", detail: NOTIFY_EXTERNAL_CAPABILITY });
      continue;
    }
    try {
      await ch.send(m);
      results.push({ channel: id, status: "sent" });
    } catch (e) {
      results.push({ channel: id, status: "failed", detail: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
    }
  }
  return results;
}
