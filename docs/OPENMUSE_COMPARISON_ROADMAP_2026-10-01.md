# openmuse 对照分析与 Kern 功能扩展路线（2026-10-01）

参考项目：[CopilotKit/openmuse](https://github.com/CopilotKit/openmuse)（MIT，Alpha）。
定位：个人 Agent + Agent Computer（浏览器 / 终端 / 文件），Expo 移动与 Web，单用户架构，CopilotKit Intelligence 托管会话。

本文回答一个问题：**openmuse 有什么值得 Kern 吸收的，什么不值得。** 结论按当前架构事实给出，不把 openmuse 的单用户假设带进 Kern。

## 1. Kern 已具备且领先的能力（不借鉴）

| 能力 | openmuse 现状 | Kern 现状 |
| --- | --- | --- |
| 业务治理 | 每次 send/write 前人工 review | Proposal / ApprovalGrant（scope + single-use）/ G1–G3 Gate / immutable audit |
| 证据与可信 | 网页内容仅作 evidence | FACT / INFERENCE 分离、独立 QA（不与执行同进程）、SourceCapture 回执、prompt injection 隔离、UNKNOWN 保持 UNKNOWN |
| 后台工作 | SQL lease + task worker | Worker 文件锁 + 心跳 + Business Event Outbox；无真实输入诚实 BLOCKED，不编造 |
| 执行机 | Docker Linux 容器（非 root、无挂载） | 真实用户 Mac：文件 / Terminal / Git / 剪贴板 / 通知 / Local Agent，回执写回原会话 |
| 多租户 | 单 owner + 共享 access key（自述 not multi-tenant） | 组织 / 角色 / 项目成员，权限矩阵 1118 项断言回归 |
| 记忆 | 可编辑 memories | core / recall 分层 + 用量配额 + 用户可遗忘 |
| 定时任务 | recurring checks（可用性 / 价格阈值） | KX-34 五段 cron + 每日简报（无内容不打扰） |
| 凭证 | TOKEN_ENCRYPTION_KEY 静态加密 | Vault 版本化密钥 + 轮换语义 |

## 2. 值得吸收的扩展点（按价值排序）

### E1 · 服务端浏览器 Worker + 会话接管（最有战略价值）

openmuse 的核心差异点：持久化 Chromium profile 常驻服务端 worker，Agent 浏览过程在 UI 内联可见，用户可随时 **Take control** 接管同一会话。

- Kern 现状：本机执行依赖用户 Mac 在线；Mac 离线时 Kern 的研究类工作没有远程执行面。
- 扩展方向：独立 browser-worker 服务（Playwright + 持久 profile），过程截图 / 抓取回执直接进 SourceCapture / Evidence 链路；「接管」复用会话 URL + 短时签名（openmuse 已验证该安全模式）。
- 组合后独有：「云端可验证的研究执行 + 治理与证据层」，openmuse 没有后者。
- 改动量：中大型。`connectors/` 已有 MCP / SSE 客户端经验，worker 注册表模式可复用 desktop-runtime 的 claim/finish 语义。

### E2 · 会话线程管理：重命名 / 归档 / 侧聊

openmuse：稳定主会话 + 侧聊 + 改名 + 归档 + 回放。Kern 的 `Conversation` 已有 `archivedAt` 字段但无操作入口，无侧聊。PM 场景「围绕一个 mission 开侧聊问细节」很自然。

- **E2a（本期落地）**：重命名 + 归档。改动小：PATCH API + Rail 侧栏交互。
- E2b（后续）：mission 内侧聊（同 product 上下文挂副线程）。

### E3 · 输入条三件套：发送/停止切换、追问队列、草稿保留

- 发送中发送键变停止键；Agent 忙时追问排队不丢；关闭页面草稿仍在（localStorage）。
- Kern 现状：SSE 流式已支持断线续传（Last-Event-ID），但输入行为未处理。半天级。

### E4 · 应用内通知中心 + 用户偏好

openmuse：durable in-app notifications + 后台更新偏好。Kern 的 `notify/` 只有单文件，attention feed 是被动汇总；Business Event Outbox 缺最后一公里的消费端 UI 与偏好（哪些事件推送 / 静默）。

### E5 · 邮件 / 日历连接器

Google OAuth 适配 + 完整线程 + 事件 CRUD；**每次写入独立 review**（与 ApprovalGrant 语义一致）。Kern 有 connectors + vault 基建，缺业务适配器。场景：「帮我把评审会约上」。

### E6 · PDF 表单工作流

附件 → PDF → 表单值 → 填写副本 → 回执，原生查看器。Kern 有 docx / excel / pptx 导出，缺 PDF 表单链。合规申报类场景契合。

### E7 · CSV 导入 → 分类汇总 → 行动

openmuse 的 Finance 是个人向；可移植到 cost-engine：渠道成本流水导入对账 + 异常项建议。

## 3. 不跟进

- 原生移动端（React Native）：投入极大；Kern 已有 mobile conditional layout 响应式方案且在 CI。
- 语音：openmuse 自己也在 roadmap，等其验证。
- CopilotKit Intelligence 线程托管：闭源外部服务、数据出域，与 Kern 自持数据原则冲突。

## 4. 执行顺序

| 阶段 | 内容 | 量级 |
| --- | --- | --- |
| 1 | E2a 会话重命名 / 归档 | 1 天内 |
| 2 | E3 输入条三件套 | 1 天内 |
| 3 | E4 通知中心 + 偏好 | 2–3 天 |
| 4 | E1 浏览器 Worker 立项（协议设计 → 抓取回执进 Evidence → 接管） | 分期 |
| 5 | E5 / E6 / E7 按 backlog 排 | — |

约束：一切新执行面必须继续满足「不确定外部写入不隐藏重试、模型不绕过治理」；E1 的抓取必须走 SourceCapture 回执，不允许无回执正文进 QA。
