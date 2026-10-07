# KX-31 连接器框架 + 通用 MCP 连接器

## 做了什么

- 用户在顶栏「连接」里填一个 MCP 服务器地址（Streamable HTTP）。Kern 会：
  1. 连接服务器；
  2. 列出它的全部工具；
  3. 按读 / 写分类保存工具快照。
- 做任务时，专家节点和红队节点的工具循环里会多出这些工具，工具名是 `mcp_<slug>_<tool>`。
- 需要登录的服务：在「凭证」里保管同一主机的 header，调用时自动注入，不需要在连接器上再配置。

## 安全链路

```
模型 → KernTool.run → ToolBroker.call（能力校验；受保护能力要审批凭据）
     → injectCredential（按主机，写审计）→ MCP tools/call（safeFetch：SSRF 校验 + 钉死 IP）
     → redactSecrets → 观察回喂模型
```

| 规则 | 实现 |
|---|---|
| 默认只读 | 读工具默认启用；写工具默认停用 |
| 读写分类 | `readOnlyHint=true` 算读；`destructiveHint=true` 或 `readOnlyHint=false` 算写；没有标注时按名字前缀判断（get / list / search / read / query / fetch / describe…），**其余一律算写** |
| 写工具 | 用户可以在连接器里「允许」，但它映射到受保护能力 `external.send`。没有审批凭据时，ToolBroker 一律拒绝，外部系统收不到任何请求 |
| 刷新 | 保留用户的开关；工具从读变成写时强制停用，需要重新确认 |
| 出站 | 复用 `safeFetch`，新增 POST / 请求头 / 响应头支持；POST 不跟随重定向；默认不放行内网和非 80 / 443 端口 |
| 本机开发 | `KERN_CONNECTOR_ALLOW_HOSTS=127.0.0.1:3999` 放行本机 MCP 服务器，**生产环境忽略** |
| 失败隔离 | 读取连接器失败时，只是连接器工具不出现，任务照常进行 |
| 审计 | `connector.add / tool.enable / tool.disable / remove`；每次调用都有 `credential.use`（注入了凭证时） |

## 代码

- `src/modules/connectors/mcp-client.ts`：最小 MCP 客户端，支持 initialize、notifications/initialized、tools/list（分页）、tools/call；能解析 JSON / SSE 响应，并处理会话 id。
- `src/modules/connectors/policy.ts`：纯函数，包括读写分类、工具快照、工具名、输入示例、结果转文本。
- `src/modules/connectors/runtime.ts`：把连接器变成 KernTool，经过 ToolBroker 和凭证注入。不碰数据库。
- `src/modules/connectors/index.ts`：服务，包括 list / add / refresh / setTool / remove / `loadConnectorTools`。
- 接口：`GET/POST /api/connectors`、`PATCH/DELETE /api/connectors/{id}`（PATCH 接受 `{tool, enabled}` 或 `{refresh:true}`）。
- 执行器：`generic-executor.ts` 在 `useTools` 时加载连接器工具，追加一段说明，被拦下时发 `node.tool` 事件（`blocked: "approval-required"`）。
- UI：`ConnectorSheet`，入口在顶栏「连接」。
- 数据库：`KernConnector` 表，迁移 `20260928140000_add_kern_connector`，纯新增。

## 验收（tests/kern-connectors.test.ts，已加入 test:regression-units）

测试会在本机起一个 mock MCP 服务器：JSON + SSE 响应、会话 id、分页、401 认证。请求走真实的 safeFetch 传输。

- CN1：分类与默认开关、刷新时的开关保留、读变写强制停用。
- CN2：JSON / SSE 解析。
- CN3：列工具（初始化、会话、分页、401；默认传输不放行本机）。
- CN4：只读调用经过 broker，注入凭证，结果带来源。
- CN5：**写调用被拦下**，服务器没有收到任何请求，`onBlocked` 被调用。
- CN6：服务器回显凭证时，观察里看不到。
- CN7：工具循环端到端，模型先读、再尝试写被拦、最后给出结论。

权限矩阵：+2 路由 / +4 方法，基线 81 / 112，990 项断言全部通过。矩阵里 POST 用内网地址探测，任何身份都返回 422，不会真的往外连。

## KX-31b 写操作审批（已完成）

没有另起一套审批系统，而是复用 KX-51b 的非阻塞提问链路：

1. 写调用被 ToolBroker 拦下（`approval-grant-required`）→ 执行器发 `node.ask`，payload 里带 `approval`：连接器、工具、输入预览、完整输入（≤ 4000 字符）、capability、resource、actionHash。同一调用在等确认时不会重复提问。
2. 状态读模型把它当成一条提问，所以自动出现在「需要你」、对话卡片和工作区里。前端只拿到 connector / title / toolName / inputPreview，**actionHash 不下发**。
3. 卡片上是「允许一次 / 不允许」，对应 `POST /api/missions/{id}/control` `{action:"approve", askId, allow}`。审批卡不能用 `answer` 回答，普通提问也不能用 `approve`。
4. 允许：`ApprovalService.issue` 签发凭据（HMAC 签名、单次有效、1 小时过期、绑定 taskRef + capability + resource + actionHash），写入 `node.answered {decision:"allow", grantId}`，然后按提问回答的路径重做该步骤。反馈里要求模型「用完全相同的输入再调用一次」。
5. 重做时，执行器从事件里恢复「actionHash → grantId」，broker 核销凭据后才真正调用 MCP。**换了输入指纹就不匹配，同一调用第二次也会因为凭据已用掉而被拦。**
6. 不允许：不签发凭据，不重做，模型在结论里写明用户未批准。
7. 没有配置 `PM_OS_APPROVAL_HMAC_SECRET` 时：写工具照样被拦；此时点「允许」会返回 503 APPROVAL_NOT_CONFIGURED，不会误放行。

修复：worker 以组织系统身份运行，连接器（以及凭证注入）原来按 worker 身份查询，一个都查不到。现在按任务发起人 `requestedByUserId` 加载。

测试：
- `tests/kern-connectors.test.ts` CN8：凭据匹配、换输入被拦、单次有效。
- `tests/regression-kern-connector-approval.ts`（`npm run test:kern-connector-approval`，真实数据库 + worker 循环 + mock MCP 服务器）：
  - AP1：写调用被拦下，审批卡进入「需要你」，任务照常完成，外部系统收不到请求。
  - AP2：参数校验。
  - AP3：允许一次 → 重做 → 外部系统恰好收到一次、输入完全一致，凭据被核销，重复批准返回 409。
  - AP4：不允许 → 不重做，不签发凭据。

## 其他遗留
- 只支持 Streamable HTTP，不支持 stdio（本机进程）传输，那部分属于 KX-35 的 shell 决策范围。
- 没有做 resources / prompts，只做了 tools。
