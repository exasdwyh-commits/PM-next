/**
 * KX-31 验收：本地 mock MCP 服务器跑通「列工具 → 只读调用 → 写调用被拦下等人」。
 * 走真实的 safeFetch 传输（allowHosts 放行本机端口），而不是替身。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { McpHttpClient, parseRpcResponse, safeTransport } from "../src/modules/connectors/mcp-client";
import {
  accessOf,
  applyAccess,
  classifyTool,
  exposedToolName,
  inputHintFromSchema,
  isConnectorAccess,
  normalizeStoredSpecs,
  refreshSpecs,
  resultToText,
  toToolSpecs,
} from "../src/modules/connectors/policy";
import { connectorTools, type ConnectorRecord } from "../src/modules/connectors/runtime";
import { runToolLoop } from "../src/modules/supervisor/tools";

const TOKEN = "Bearer mcp-secret-token-123456";
const calls: string[] = [];
let sessionsSeen = new Set<string>();
let server: http.Server;
let base = "";

const TOOLS = [
  { name: "list_orders", description: "列出最近订单", inputSchema: { type: "object", properties: { limit: { type: "integer" } } }, annotations: { readOnlyHint: true } },
  { name: "echo_auth", description: "回显收到的认证头（用来验证不回显）", inputSchema: { type: "object", properties: {} } },
  { name: "send_email", description: "发送邮件", inputSchema: { type: "object", properties: { to: { type: "string" } }, required: ["to"] } },
  { name: "delete_order", description: "删除订单", annotations: { destructiveHint: true } },
];

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.headers.authorization !== TOKEN) {
        res.writeHead(401).end();
        return;
      }
      const msg = JSON.parse(body) as { id?: number; method: string; params?: { name?: string; cursor?: string; arguments?: Record<string, unknown> } };
      if (msg.method !== "initialize") {
        const sid = String(req.headers["mcp-session-id"] ?? "");
        assert.equal(sid, "sess-1", "初始化后必须带上会话 id");
        sessionsSeen.add(sid);
      }
      if (msg.id === undefined) {
        res.writeHead(202).end();
        return;
      }
      const reply = (result: unknown, sse = false) => {
        const payload = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result });
        if (sse) {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.end(`event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\nevent: message\ndata: ${payload}\n\n`);
        } else {
          res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "sess-1" });
          res.end(payload);
        }
      };
      if (msg.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mock-shop", version: "0.1" } });
      if (msg.method === "tools/list") {
        // 分页：第一页 2 个，第二页其余
        return msg.params?.cursor === "p2" ? reply({ tools: TOOLS.slice(2) }) : reply({ tools: TOOLS.slice(0, 2), nextCursor: "p2" });
      }
      if (msg.method === "tools/call") {
        calls.push(msg.params!.name!);
        if (msg.params!.name === "list_orders") return reply({ content: [{ type: "text", text: `订单：A-1 ¥199，A-2 ¥299（limit=${msg.params!.arguments?.limit ?? "-"}）` }] }, true);
        if (msg.params!.name === "echo_auth") return reply({ content: [{ type: "text", text: `你发来的是 ${req.headers.authorization}` }] });
        return reply({ content: [{ type: "text", text: "已执行写操作" }] });
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "no method" } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((r) => server.close(() => r())));

const transport = () => safeTransport({ allowHosts: [base] });

test("U01：工具信任——冲突声明按写、无声明不是只读、名称前缀不决定权限", () => {
  // destructive + readOnly 冲突：按写（停用、映射受保护能力）
  const conflict = { name: "list_and_purge", annotations: { readOnlyHint: true, destructiveHint: true } };
  assert.equal(classifyTool(conflict), "write", "冲突声明必须按写");
  const [c] = toToolSpecs([conflict]);
  assert.equal(c.enabled, false, "冲突工具默认停用");
  assert.equal(c.capability, "external.send", "冲突工具映射受保护能力，调用仍需审批");
  // 无声明 / 空声明 / readOnlyHint 非 true：一律按写，无论名字多像只读
  for (const name of ["get_user", "list", "search", "read_file", "fetch-page", "describeTable", "query_db"]) {
    assert.equal(classifyTool({ name }), "write", `无声明的 ${name} 不得按名称判为读`);
    assert.equal(classifyTool({ name, annotations: {} }), "write", `空声明的 ${name} 不得判为读`);
  }
  assert.equal(classifyTool({ name: "get_user", annotations: { readOnlyHint: false } }), "write");
  assert.equal(classifyTool({ name: "x", annotations: { idempotentHint: true, openWorldHint: false } }), "write", "其他提示不等于只读");
  // 只有显式 readOnlyHint=true（且未声明破坏性）才是读
  assert.equal(classifyTool({ name: "anything", annotations: { readOnlyHint: true } }), "read");
  assert.equal(classifyTool({ name: "anything", annotations: { readOnlyHint: true, destructiveHint: false } }), "read");
  // 迁移：旧规则按前缀判为读且已启用的工具，刷新后变写，必须强制停用、重新确认
  const legacy = [{ name: "get_user", title: "get_user", description: "", effect: "read" as const, enabled: true, capability: "connector.read", inputSchema: null }];
  const [m] = toToolSpecs([{ name: "get_user" }], legacy);
  assert.deepEqual([m.effect, m.enabled, m.capability], ["write", false, "external.send"], "旧的伪只读工具刷新后必须停用");
  // 合规优化：不静默停用——记录依据与原因；不提供「自行标记为只读」的旁路
  assert.equal(m.basis, "undeclared");
  assert.match(m.reconfirm ?? "", /没有声明该工具只读/, "强制停用必须给出原因");
  assert.match(m.reconfirm ?? "", /每次调用仍需你确认/, "重新允许后仍逐次审批");
  const [kept] = toToolSpecs([{ name: "get_user" }], [m]);
  assert.equal(kept.enabled, false);
  assert.equal(kept.reconfirm, m.reconfirm, "仍停用时原因保留，不会在下次刷新时消失");
  const [allowed] = toToolSpecs([{ name: "get_user" }], [{ ...kept, enabled: true }]);
  assert.deepEqual([allowed.effect, allowed.enabled, allowed.capability, allowed.reconfirm], ["write", true, "external.send", null], "用户重新允许：仍是写工具（逐次审批），原因清除");
  const [quiet] = toToolSpecs([{ name: "get_user" }], [{ ...legacy[0], enabled: false }]);
  assert.equal(quiet.reconfirm, null, "本来就停用的工具不打扰用户");
  const [back] = toToolSpecs([{ name: "get_user", annotations: { readOnlyHint: true } }], [kept]);
  assert.deepEqual([back.effect, back.basis, back.reconfirm], ["read", "declared-read", null], "服务端补上只读声明后恢复为读，原因清除");
  assert.equal(c.basis, "conflict");
  assert.match(toToolSpecs([conflict], [{ ...legacy[0], name: "list_and_purge" }])[0].reconfirm ?? "", /自相矛盾/);
  // 界面必须把原因展示给用户（停用状态下）
  const sheets = fs.readFileSync(path.join(process.cwd(), "src/app/muse/components/sheets.tsx"), "utf8");
  assert.match(sheets, /!t\.enabled && t\.reconfirm \? <p[^>]*data-testid="conn-tool-reconfirm"/);
});

test("CN1：读写分类与默认开关；刷新保留开关，读变写强制停用", () => {
  assert.deepEqual(TOOLS.map((t) => classifyTool(t)), ["read", "write", "write", "write"]);
  assert.equal(classifyTool({ name: "getUser" }), "write", "U01：名称前缀不得决定权限");
  assert.equal(classifyTool({ name: "search_docs" }), "write", "U01：未声明只读的工具不能默认可信只读");
  assert.equal(classifyTool({ name: "get_and_delete", annotations: { destructiveHint: true } }), "write");
  const specs = toToolSpecs(TOOLS);
  assert.deepEqual(specs.map((s) => [s.name, s.enabled, s.capability]), [
    ["list_orders", true, "connector.read"],
    ["echo_auth", false, "external.send"],
    ["send_email", false, "external.send"],
    ["delete_order", false, "external.send"],
  ]);
  specs[0].enabled = false;
  specs[2].enabled = true;
  const again = toToolSpecs(TOOLS, specs);
  assert.equal(again[0].enabled, false, "保留用户关掉的读工具");
  assert.equal(again[2].enabled, true, "保留用户打开的写工具");
  const flipped = toToolSpecs([{ ...TOOLS[0], annotations: { readOnlyHint: false } }], [{ ...specs[0], enabled: true }]);
  assert.equal(flipped[0].enabled, false, "读变写必须重新确认");
  assert.equal(exposedToolName("mock_shop", "list-orders.v2"), "mcp_mock_shop_list_orders_v2");
  assert.equal(inputHintFromSchema(TOOLS[2].inputSchema ?? null), '{"to":"…"}');
  assert.equal(resultToText({ content: [{ type: "image" }, { type: "text", text: "ok" }] }), "[image 内容]\nok");
});

test("CN2：解析 JSON 与 SSE 响应，按 id 取结果", () => {
  assert.deepEqual(parseRpcResponse("application/json", '{"jsonrpc":"2.0","id":3,"result":{"a":1}}', 3), { jsonrpc: "2.0", id: 3, result: { a: 1 } });
  const sse = 'data: {"jsonrpc":"2.0","method":"x"}\n\ndata: {"jsonrpc":"2.0","id":7,\ndata: "result":{"ok":true}}\n\n';
  assert.deepEqual(parseRpcResponse("text/event-stream", sse, 7)?.result, { ok: true });
  assert.equal(parseRpcResponse("application/json", '{"id":1}', 2), null);
});

test("CN3：列工具（初始化、会话 id、分页、认证）", async () => {
  const client = new McpHttpClient(`http://${base}/mcp`, transport(), { Authorization: TOKEN });
  const tools = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), TOOLS.map((t) => t.name));
  assert.equal(client.serverInfo?.name, "mock-shop");
  assert.ok(sessionsSeen.has("sess-1"));
  await assert.rejects(new McpHttpClient(`http://${base}/mcp`, transport()).listTools(), /拒绝访问（401）/);
  await assert.rejects(new McpHttpClient(`http://${base}/mcp`, safeTransport()).listTools(), /端口|内网/, "默认传输不放行本机");
});

function record(): ConnectorRecord {
  const specs = toToolSpecs(TOOLS);
  specs.find((s) => s.name === "echo_auth")!.enabled = true; // 用户打开的「写」工具（未标注，按写处理）
  specs.find((s) => s.name === "send_email")!.enabled = true;
  return { id: "c1", name: "Mock 商店", slug: "mock_shop", url: `http://${base}/mcp`, tools: specs };
}

test("U04：快照升级保守、幂等、不修改原数据，现代只读和显式写授权保持可用", () => {
  const [modernRead] = toToolSpecs([TOOLS[0]]);
  const [modernWrite] = toToolSpecs([TOOLS[2]]);
  const legacyRead = { ...modernRead };
  delete legacyRead.basis;
  const legacyWrite = { ...modernWrite, enabled: true, capability: "connector.read" };
  delete legacyWrite.basis;
  const original = [modernRead, { ...modernRead, name: "paused", enabled: false }, legacyRead, legacyWrite];
  const before = JSON.stringify(original);
  const normalized = normalizeStoredSpecs(original);
  assert.equal(JSON.stringify(original), before);
  assert.deepEqual(normalized.map((t) => [t.effect, t.enabled, t.capability]), [
    ["read", true, "connector.read"], ["read", false, "connector.read"],
    ["write", false, "external.send"], ["write", true, "external.send"],
  ]);
  assert.match(normalized[2].reconfirm ?? "", /旧工具快照.*停用/);
  assert.match(normalized[2].reconfirm ?? "", /每次调用仍需你确认/);
  assert.equal(normalized[3].reconfirm, null);
  assert.deepEqual(normalizeStoredSpecs(normalized), normalized, "读取投影可以安全重复执行");
});

test("U05：无效或相互矛盾的存储字段不升级为默认只读", () => {
  const [read] = toToolSpecs([TOOLS[0]]);
  for (const changed of [
    { basis: undefined }, { basis: "conflict" }, { basis: "other" },
    { capability: "external.send" }, { capability: undefined }, { effect: undefined },
  ]) {
    const [t] = normalizeStoredSpecs([{ ...read, ...changed }]);
    assert.deepEqual([t.effect, t.enabled, t.capability], ["write", false, "external.send"]);
  }
  for (const value of [null, {}, "[]", 1]) assert.deepEqual(normalizeStoredSpecs(value), []);
  assert.deepEqual(normalizeStoredSpecs([null, [], {}, { name: " " }]), []);
  const [invalid] = normalizeStoredSpecs([{ name: "get_bad", effect: "write", enabled: "true", inputSchema: [], title: 1 }]);
  assert.equal(invalid.enabled, false, "字符串 true 不能变成授权");
  assert.equal(invalid.title, "get_bad");
  assert.equal(invalid.inputSchema, null);
  assert.equal(normalizeStoredSpecs(Array.from({ length: 100 }, () => read)).length, 64);
});

test("U06：升级后只读档不启用旧工具，显式重开仍按写逐次审批", () => {
  const [read] = toToolSpecs([TOOLS[0]]);
  delete read.basis;
  const upgraded = normalizeStoredSpecs([read]);
  assert.equal(accessOf(upgraded), "off");
  assert.equal(applyAccess(upgraded, "read")[0].enabled, false);
  const reopened = normalizeStoredSpecs(applyAccess(upgraded, "interact"));
  assert.deepEqual([reopened[0].effect, reopened[0].enabled, reopened[0].capability, reopened[0].reconfirm],
    ["write", true, "external.send", null]);
  const refreshed = refreshSpecs([TOOLS[0]], upgraded);
  assert.equal(refreshed[0].enabled, false, "刷新声明不能悄悄重开已关闭的连接器");
  assert.equal(refreshed[0].basis, "declared-read");
});

test("U07：服务端读取与运行时都使用安全投影，不只修刷新入口", () => {
  const service = fs.readFileSync(path.join(process.cwd(), "src/modules/connectors/index.ts"), "utf8");
  const runtime = fs.readFileSync(path.join(process.cwd(), "src/modules/connectors/runtime.ts"), "utf8");
  assert.match(service, /const specsOf[^\n]*normalizeStoredSpecs\(r\.tools\)/);
  assert.match(runtime, /normalizeStoredSpecs\(c\.tools\)\.filter/);
});

test("U02：未刷新旧快照也不能继续以只读权限运行", () => {
  const legacy = { ...record(), tools: [{
    name: "list_orders", title: "旧订单工具", description: "", effect: "read" as const,
    enabled: true, capability: "connector.read", inputSchema: null,
  }] };
  let requests = 0;
  const tools = connectorTools([legacy], {
    owner: { userId: "u1", organizationId: "o1" },
    transport: async () => { requests += 1; throw new Error("不应访问网络"); },
    taskRef: "m1", runId: "r1",
  });
  assert.equal(tools.length, 0, "缺少只读分类依据的旧快照必须先停用，不等待用户刷新");
  assert.equal(requests, 0);
  assert.equal(legacy.tools[0].enabled, true, "安全读取不得原地修改调用方的快照");
});

test("U03：已启用写工具的旧 capability 不能绕过审批", async () => {
  calls.length = 0;
  const c = record();
  const write = c.tools.find((t) => t.name === "send_email")!;
  write.capability = "connector.read";
  const blocked: string[] = [];
  const tools = connectorTools([c], {
    owner: { userId: "u1", organizationId: "o1" }, transport: transport(),
    inject: async () => ({ headers: { Authorization: TOKEN }, secrets: [TOKEN] }),
    taskRef: "m1", runId: "r1",
    onBlocked: ({ capability }) => void blocked.push(capability),
  });
  const result = await tools.find((t) => t.name.endsWith("send_email"))!.run({ to: "a@b.com" }, { organizationId: "o1" });
  assert.equal(result.ok, false, "写工具必须按当前策略重新绑定受保护能力");
  assert.deepEqual(blocked, ["external.send"]);
  assert.deepEqual(calls, [], "即使快照字段不一致，模拟外部服务也不能收到写调用");
});

test("CN4：只读调用经 broker 执行，凭证注入，结果带来源", async () => {
  const injected: string[] = [];
  const tools = connectorTools([record()], {
    owner: { userId: "u1", organizationId: "o1" },
    transport: transport(),
    inject: async ({ host }) => {
      injected.push(host);
      return { headers: { Authorization: TOKEN }, secrets: [TOKEN] };
    },
    taskRef: "m1",
    runId: "r1",
  });
  assert.deepEqual(tools.map((t) => [t.name, t.risk]), [
    ["mcp_mock_shop_list_orders", "read"],
    ["mcp_mock_shop_echo_auth", "ask"],
    ["mcp_mock_shop_send_email", "ask"],
  ], "停用的 delete_order 不暴露");
  const r = await tools[0].run({ limit: 2 }, { organizationId: "o1" });
  assert.equal(r.ok, true);
  assert.match(r.output, /A-1 ¥199.*limit=2/);
  assert.equal(r.citations?.[0].ref, "connector:c1#list_orders");
  assert.deepEqual(injected, [base]);
});

test("CN5：写调用被拦下等人——服务器从未收到调用，onBlocked 被通知", async () => {
  calls.length = 0;
  const blocked: string[] = [];
  const tools = connectorTools([record()], {
    owner: { userId: "u1", organizationId: "o1" },
    transport: transport(),
    inject: async () => ({ headers: { Authorization: TOKEN }, secrets: [TOKEN] }),
    taskRef: "m1",
    runId: "r1",
    onBlocked: ({ tool, reason }) => void blocked.push(`${tool}:${reason}`),
  });
  const send = tools.find((t) => t.name.endsWith("send_email"))!;
  const r = await send.run({ to: "a@b.com" }, { organizationId: "o1" });
  assert.equal(r.ok, false);
  assert.match(r.output, /已拦下.*已请用户确认/);
  assert.deepEqual(blocked, ["send_email:approval-service-required"]);
  assert.deepEqual(calls, [], "写工具在 broker 层被拦，外部系统没有收到任何请求");
});

test("CN6：不回显——即使服务器回显凭证，观察里也看不到", async () => {
  const specs = toToolSpecs([{ ...TOOLS[1], annotations: { readOnlyHint: true } }]);
  const tools = connectorTools([{ ...record(), tools: specs }], {
    owner: { userId: "u1", organizationId: "o1" },
    transport: transport(),
    inject: async () => ({ headers: { Authorization: TOKEN }, secrets: [TOKEN] }),
    taskRef: "m1",
    runId: "r1",
  });
  const r = await tools[0].run({}, { organizationId: "o1" });
  assert.equal(r.ok, true);
  assert.doesNotMatch(r.output, /mcp-secret-token/);
  assert.match(r.output, /凭证已隐藏/);
});

test("CN7：工具循环端到端——模型调用连接器工具，拿到观察后给结论", async () => {
  const tools = connectorTools([record()], {
    owner: { userId: "u1", organizationId: "o1" },
    transport: transport(),
    inject: async () => ({ headers: { Authorization: TOKEN }, secrets: [TOKEN] }),
    taskRef: "m1",
    runId: "r1",
  });
  let turn = 0;
  const out = await runToolLoop({
    messages: [{ role: "user", content: "看看最近订单" }],
    tools,
    ctx: { organizationId: "o1" },
    invoke: async (msgs) => {
      turn += 1;
      if (turn === 1) return { text: '```kern-tool\n{"tool":"mcp_mock_shop_list_orders","input":{"limit":5}}\n```', provenance: {} };
      if (turn === 2) {
        assert.match(msgs[msgs.length - 1].content, /A-2 ¥299/);
        return { text: '```kern-tool\n{"tool":"mcp_mock_shop_send_email","input":{"to":"x@y.com"}}\n```', provenance: {} };
      }
      assert.match(msgs[msgs.length - 1].content, /已拦下/);
      return { text: "最近 2 单，合计 ¥498；发邮件待用户确认。", provenance: {} };
    },
  });
  assert.ok("text" in out && /待用户确认/.test(out.text));
  assert.deepEqual(out.toolCalls?.map((c) => [c.tool, c.ok]), [
    ["mcp_mock_shop_list_orders", true],
    ["mcp_mock_shop_send_email", false],
  ]);
});

test("CN8：审批凭据——批准后同一调用执行一次；再调或换输入都被拦", async () => {
  const { ApprovalService } = await import("../src/modules/governance/approval-service");
  type Rec = Parameters<InstanceType<typeof ApprovalService>["verify"]>[0];
  const rows = new Map<string, NonNullable<Rec>>();
  const store = {
    create: async (g: Omit<NonNullable<Rec>, "usedAt" | "usedByRunId">) => {
      const r = { ...g, usedAt: null, usedByRunId: null };
      rows.set(g.id, r);
      return r;
    },
    find: async (id: string) => rows.get(id) ?? null,
    consume: async (id: string, runId: string, now: Date) => {
      const r = rows.get(id);
      if (!r || r.usedAt) return false;
      r.usedAt = now;
      r.usedByRunId = runId;
      return true;
    },
  };
  const svc = new ApprovalService(store, "x".repeat(40));
  calls.length = 0;
  const blocked: { actionHash: string; resource: string; capability: string }[] = [];
  const grants = new Map<string, string>();
  const make = () =>
    connectorTools([record()], {
      owner: { userId: "u1", organizationId: "o1" },
      transport: transport(),
      inject: async () => ({ headers: { Authorization: TOKEN }, secrets: [TOKEN] }),
      taskRef: "m1",
      runId: "r1",
      approvalService: svc,
      grants,
      onBlocked: (b) => void blocked.push(b),
    }).find((t) => t.name.endsWith("send_email"))!;
  const r1 = await make().run({ to: "a@b.com" }, { organizationId: "o1" });
  assert.equal(r1.ok, false);
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].capability, "external.send");
  const grant = await svc.issue({ userId: "u1", organizationId: "o1" } as never, {
    taskRef: "m1",
    capability: blocked[0].capability,
    resource: blocked[0].resource,
    actionHash: blocked[0].actionHash,
    validUntil: new Date(Date.now() + 60_000),
  });
  grants.set(blocked[0].actionHash, grant.id);
  const other = await make().run({ to: "evil@x.com" }, { organizationId: "o1" });
  assert.equal(other.ok, false, "换了输入，凭据不匹配");
  const ok = await make().run({ to: "a@b.com" }, { organizationId: "o1" });
  assert.equal(ok.ok, true);
  assert.match(ok.output, /已执行写操作/);
  assert.deepEqual(calls, ["send_email"], "外部系统只收到批准的那一次");
  const again = await make().run({ to: "a@b.com" }, { organizationId: "o1" });
  assert.equal(again.ok, false, "一次性：用过即失效");
  assert.ok(rows.get(grant.id)?.usedAt);
  assert.equal(calls.length, 1);
});

test("CN9（KX-61）：权限三档——由开关推出档位，切档即批量改开关，刷新保持关闭", () => {
  const tools = [
    { name: "list_docs", annotations: { readOnlyHint: true } },
    { name: "create_doc", annotations: { destructiveHint: true } },
  ];
  const base = toToolSpecs(tools);
  assert.equal(accessOf(base), "read");
  const on = applyAccess(base, "interact");
  assert.deepEqual(on.map((t) => t.enabled), [true, true]);
  assert.equal(accessOf(on), "interact");
  const off = applyAccess(on, "off");
  assert.equal(accessOf(off), "off");
  assert.equal(accessOf(applyAccess(off, "read")), "read");
  assert.equal(accessOf([{ ...base[0], enabled: false }, { ...base[1], enabled: true }]), "custom");
  assert.equal(accessOf([]), "off");
  assert.equal(accessOf(toToolSpecs([tools[0]])), "read");
  // 刷新：关闭的连接器，新增的读工具也保持关闭
  const refreshed = refreshSpecs([...tools, { name: "search_docs", annotations: { readOnlyHint: true } }], off);
  assert.equal(accessOf(refreshed), "off");
  // 刷新：读写交互下新增的写工具默认停用 → 变成自定义，需要用户重新确认
  const r2 = refreshSpecs([...tools, { name: "delete_doc", annotations: { destructiveHint: true } }], on);
  assert.equal(r2.find((t) => t.name === "delete_doc")?.enabled, false);
  assert.equal(accessOf(r2), "custom");
  assert.equal(isConnectorAccess("read"), true);
  assert.equal(isConnectorAccess("write"), false);
});
