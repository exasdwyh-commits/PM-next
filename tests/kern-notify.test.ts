import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RESERVED_CHANNELS,
  dispatchNotification,
  listNotifyChannels,
  normalizeMessage,
  registerNotifyChannel,
  unregisterNotifyChannelForTest,
  type NotifyChannel,
  type NotifyMessage,
} from "../src/modules/notify";

const msg: NotifyMessage = { title: "  计划   已完成 ", body: "内容", level: "info", link: "/muse?c=1" };

test("默认只有应用内渠道生效，飞书等仅为保留名额", () => {
  const list = listNotifyChannels();
  assert.equal(list.find((c) => c.id === "inbox")?.state, "active");
  for (const r of RESERVED_CHANNELS) assert.equal(list.find((c) => c.id === r.id)?.state, "reserved");
});

test("不点名渠道时只发 inbox", async () => {
  assert.deepEqual(await dispatchNotification(msg), [{ channel: "inbox", status: "sent" }]);
});

test("保留渠道与未知渠道被跳过，不抛错", async () => {
  const r = await dispatchNotification(msg, { channels: ["feishu", "nope"] });
  assert.deepEqual(r, [
    { channel: "feishu", status: "skipped", detail: "reserved" },
    { channel: "nope", status: "skipped", detail: "unknown" },
  ]);
});

test("外部渠道没有审批凭据不发送；有凭据才发送；失败被收敛", async () => {
  const sent: NotifyMessage[] = [];
  const ch: NotifyChannel = { id: "webhook", label: "Webhook", kind: "external", isConfigured: () => true, send: async (m) => { sent.push(m); } };
  registerNotifyChannel(ch);
  try {
    assert.equal((await dispatchNotification(msg, { channels: ["webhook"] }))[0].status, "needs_approval");
    assert.equal(sent.length, 0);
    assert.equal((await dispatchNotification(msg, { channels: ["webhook"], approvedExternal: true }))[0].status, "sent");
    assert.equal(sent[0].title, "计划 已完成");
    ch.send = async () => { throw new Error("boom"); };
    assert.deepEqual((await dispatchNotification(msg, { channels: ["webhook"], approvedExternal: true }))[0], { channel: "webhook", status: "failed", detail: "boom" });
  } finally {
    unregisterNotifyChannelForTest("webhook");
  }
});

test("未配置的外部渠道跳过；不能覆盖 inbox 或注册内置渠道", async () => {
  registerNotifyChannel({ id: "email", label: "邮件", kind: "external", isConfigured: () => false, send: async () => {} });
  try {
    assert.equal((await dispatchNotification(msg, { channels: ["email"], approvedExternal: true }))[0].detail, "unconfigured");
    assert.equal(listNotifyChannels().find((c) => c.id === "email")?.state, "unconfigured");
  } finally {
    unregisterNotifyChannelForTest("email");
  }
  assert.throws(() => registerNotifyChannel({ id: "inbox", label: "x", kind: "external", isConfigured: () => true, send: async () => {} }));
  assert.throws(() => registerNotifyChannel({ id: "x", label: "x", kind: "builtin", isConfigured: () => true, send: async () => {} }));
});

test("消息规整：截断、只允许站内相对链接", () => {
  assert.equal(normalizeMessage({ ...msg, link: "https://evil.example" }).link, undefined);
  assert.equal(normalizeMessage({ ...msg, link: "//evil.example" }).link, undefined);
  assert.equal(normalizeMessage({ ...msg, title: "a".repeat(300) }).title.length, 120);
});
