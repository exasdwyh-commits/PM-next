/**
 * KX-71 统一能力目录：纯函数单测（不碰数据库）。
 * 断言：五类来源都进同一份清单；权限档与可用性推导正确；检索能按中文 / 英文命中。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCapabilityDirectory,
  capabilityDigest,
  searchCapabilities,
  type CapabilityDirectoryInputs,
} from "@/modules/assistant-runtime/capabilities/directory";

function inputs(over: Partial<CapabilityDirectoryInputs> = {}): CapabilityDirectoryInputs {
  return {
    tools: [
      { name: "knowledge_search", label: "检索知识库", description: "在公司知识库里找依据", inputHint: '{"query":"..."}', risk: "read" },
      { name: "web_search", label: "网页检索", description: "在公开网页检索最新信息", inputHint: '{"query":"..."}', risk: "read" },
      { name: "ask_user", label: "向你提问", description: "缺关键信息时问一次", inputHint: "{}", risk: "ask" },
      { name: "knowledge_search", label: "重复项", description: "应被去重", inputHint: "{}", risk: "read" },
    ],
    webSearchConfigured: false,
    desktopOnline: false,
    connectors: [
      {
        id: "c1",
        name: "飞书日历",
        host: "mcp.example.com",
        lastError: null,
        tools: [
          { name: "list_events", title: "列日程", description: "读取日程", effect: "read", enabled: true },
          { name: "create_event", title: "建日程", description: "创建日程", effect: "write", enabled: true },
          { name: "delete_event", title: "删日程", description: "删除日程", effect: "write", enabled: false },
        ],
      },
      { id: "c2", name: "坏掉的", host: "down.example.com", lastError: "连接失败：ECONNREFUSED", tools: [{ name: "ping", title: "ping", description: "", effect: "read", enabled: true }] },
    ],
    playbooks: [{ id: "p1", name: "竞品价格周报", sourceGoal: "每周整理智能宠物喂食器竞品价格", steps: 4, useCount: 3, successCount: 3, failureCount: 0 }],
    knowledge: {
      sources: [
        { id: "k1", name: "产品手册", kind: "OBSIDIAN_VAULT", enabled: true, documentCount: 12 },
        { id: "k2", name: "空库", kind: "OBSIDIAN_VAULT", enabled: true, documentCount: 0 },
      ],
      confirmedFactsCount: 5,
    },
    now: new Date("2026-09-29T00:00:00Z"),
    ...over,
  };
}

test("五类来源进同一份清单，数量与 id 前缀一致", () => {
  const d = buildCapabilityDirectory(inputs());
  assert.equal(d.generatedAt, "2026-09-29T00:00:00.000Z");
  assert.ok(d.counts.native >= 7, "原生能力至少 7 条（Capability Registry）");
  assert.equal(d.counts.tool, 4, "knowledge_search / web_search / ask_user 去重后 3 条 + 办公导出");
  assert.equal(d.counts.plugin, 4);
  assert.equal(d.counts.skill, 1);
  assert.equal(d.counts.knowledge, 3, "两个知识源 + 公司事实");
  for (const it of d.items) assert.ok(it.id.startsWith(`${it.kind}:`), `${it.id} 前缀应为 kind`);
  const ids = d.items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, "id 不重复");
});

test("权限档与可用性：写工具要问人、关闭的为 off、出错 / 未配置 / 离线为不可用", () => {
  const d = buildCapabilityDirectory(inputs());
  const by = (id: string) => d.items.find((i) => i.id === id)!;
  assert.equal(by("plugin:c1/list_events").access, "read");
  assert.equal(by("plugin:c1/create_event").access, "ask");
  assert.equal(by("plugin:c1/delete_event").access, "off");
  assert.equal(by("plugin:c1/delete_event").available, false);
  assert.equal(by("plugin:c2/ping").available, false);
  assert.match(by("plugin:c2/ping").unavailableReason ?? "", /ECONNREFUSED/);
  assert.equal(by("tool:web_search").available, false);
  assert.equal(by("tool:ask_user").access, "ask");
  assert.equal(by("native:desktop").available, false);
  assert.equal(by("native:product-write").access, "ask");
  assert.equal(by("knowledge:k2").available, false);
  assert.equal(by("knowledge:company-facts").available, true);

  const online = buildCapabilityDirectory(inputs({ desktopOnline: true, webSearchConfigured: true }));
  assert.equal(online.items.find((i) => i.id === "native:desktop")!.available, true);
  assert.equal(online.items.find((i) => i.id === "tool:web_search")!.available, true);
});

test("检索：中文与英文关键词都能命中，不可用条目降权", () => {
  const d = buildCapabilityDirectory(inputs());
  const top = (q: string) => searchCapabilities(d.items, q, 3).map((i) => i.id);
  assert.equal(top("竞品价格")[0], "skill:p1");
  assert.equal(top("日程")[0].startsWith("plugin:c1/"), true);
  assert.equal(top("docx 导出")[0], "tool:office_export");
  assert.ok(top("knowledge").includes("knowledge:k1"));
  // 空查询：原样返回前 N 条。
  assert.equal(searchCapabilities(d.items, "  ", 2).length, 2);
});

test("给模型看的摘要只含可用条目、一行一条", () => {
  const d = buildCapabilityDirectory(inputs());
  const digest = capabilityDigest(d.items, 100);
  assert.ok(!digest.includes("网页检索"), "未配置的网页检索不出现");
  assert.ok(!digest.includes("坏掉的"), "出错的连接器不出现");
  assert.ok(digest.includes("[skill/read] 竞品价格周报"));
  assert.equal(digest.split("\n").every((l) => l.startsWith("- [")), true);
});
