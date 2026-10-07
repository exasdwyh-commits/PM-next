# KX-71 统一能力目录：Kern 现在会什么（窗口 A 用）

> 状态：KX-71 完成，`feat/kern-experience`。本页是给用户看的「现有能力目录」，用来决定先补哪些能力；
> 代码侧的真实目录由 `GET /api/capabilities` 实时生成（连接器 / 做法 / 知识库按当前账号读取）。

## 1. 这次做了什么

1. **同一份清单**：新增契约 `kern-contracts/capability.ts`（`CapabilityEntry`：说明、输入、输出、权限档、来源、审计落点、可用性、标签）；
   `assistant-runtime/capabilities/directory.ts` 把五类来源拼成一份目录并提供关键词检索；
   `directory-loader.ts` 读真实数据；`GET /api/capabilities?q=` 对外。权限矩阵已登记（91 路由 / 126 方法）。
2. **执行仍走原通道**：目录只「登记 + 检索」，不另起一套执行。原生能力走 Capability Registry，
   工具走 supervisor 工具循环，插件走连接器运行时（写工具先审批），做法走 playbooks 匹配。
3. **拆大环（第一步）**：worker 处理器注册表 + `kern-contracts` 纯契约 + 标签 / 类型下沉。
   越界 import 基线 20 → 8，worker 已完全脱离大环；运行时最大环仍是 14 个模块（见 §4）。
4. **「按需检索调用」的接线**留到 KX-72：任务契约卡里要写「本次会用到哪些能力」，届时用 `searchCapabilities` +
   `capabilityDigest` 喂给模型，一处接线两处受益，避免现在改 prompt 又要再改一次。

## 2. 现有能力目录（按 kind）

权限档：`read` 只读自动执行；`ask` 执行前问人；`write` 用户已明确放开；`off` 登记了但关着。

### 2.1 原生能力（native，7 条，内置于 Capability Registry）

| 能力 | 说明 | 权限档 | 审计 |
|---|---|---|---|
| 工作状态 | 产品、项目、待办、待决事项 | read | 对话工具调用记录 |
| 知识库 | 检索公司事实、知识文档 | read | 同上 |
| 产品操作 | 建产品、改方案字段、建工作项（都以提案形式，需确认） | ask | 提案记录 |
| 产品研发 | 启动 / 跟踪 / 读取 Product R&D（第一个任务包） | read | 任务时间线 |
| 挑战判断 | 证伪、红队、关键假设压力测试 | read | 挑战报告 |
| 本机执行 | 通过 Desktop Runtime 用文件 / 终端 / Git / 浏览器 | ask | 本机任务确认记录 |
| 可视化 | KernGraph 结构 / 依赖 / 顾问图 | read | 对话记录 |

### 2.2 工具（tool，6 条）

| 工具 | 说明 | 权限档 | 现状 |
|---|---|---|---|
| knowledge_search | 检索组织知识库 + 已确认公司事实 | read | 可用 |
| calculate | 精确计算（价格、毛利、规模估算） | read | 可用 |
| web_search | 公开网页检索 | read | **未配置提供方时不可用**（目录里会标出） |
| web_fetch | 打开公开网页读正文（禁内网） | read | 同上 |
| ask_user | 节点中途向用户问一次、带默认假设 | ask | 可用 |
| office_export | 结论导出 docx / xlsx / pptx / md / pdf | read | 可用 |

### 2.3 本机动作（属于「本机执行」，Desktop Runtime 在线时可用）

文件列 / 读 / 写 / 建目录 / 移动、终端命令、git status / diff、打开网页、打开应用、剪贴板读写、系统通知、
macOS AppleScript、委托本机 Agent。写 / 覆盖 / 任意命令都要先确认（受保护动作清单）。

### 2.4 插件（plugin，MCP 连接器）

由用户在「连接器」里添加的 MCP 服务器；每个工具一条，读工具默认开、写工具默认关且执行前审批。
**当前仓库里没有预置任何公司系统连接器**（飞书、企业微信、钉钉、邮箱、日历、OA 都还没有）。

### 2.5 技能 / 做法（skill）

由顺利完成的任务一键沉淀（KX-36），按目标相似度匹配复用；目录里显示用过几次、成功几次。
**当前没有预置做法**，全部来自用户自己的任务。

### 2.6 知识库（knowledge）

支持 Obsidian Vault / 本地目录只读导入（`OBSIDIAN_VAULT` / `LOCAL_DIR`），加「公司事实」表。
**没有预置公司制度 / 产品资料 / 客户资料**。

## 3. 请用户在窗口 A 决定（回答写进 `docs/mcp-requests.md` 即可）

1. **接哪些公司系统**（按优先级排 1–3 个）：飞书 / 企业微信 / 钉钉 / 邮箱（IMAP / Exchange / Gmail）/ 日历 / OA / CRM / 网盘 / Git 平台 / 其它。
   每个系统请说明：只读（看消息、看日程、搜文件）还是可写（发消息、建日程、提交审批）。
   > 注意用户既定决策：暂不接飞书；如改变请明说。
2. **放哪些知识库**：公司制度 / 产品资料 / 客户资料 / 合同模板 / 历史项目复盘…… 以什么形式存在（Obsidian、文件夹、Notion、飞书文档、Confluence、SharePoint）。
3. **要哪些技能**（先选 3–5 个，KX-72 之后用「3 次成功才自动化」的规则逐个上线）：
   周报 / 会议纪要 / 报销初审 / 合同初审 / 竞品周报 / 招聘 JD 与简历初筛 / 客户跟进提醒 / 数据周表 / 其它。
4. **网页检索提供方**：要不要配（Tavily / Bing / SerpAPI / 自建 SearXNG），谁付费。
5. **参考产品**：想对标的办公助理产品（Muse、Grok Bot、其它）及具体想借鉴的点。

## 4. 架构现状（KX-71 之后）

- 越界 import：**8 条**（`tests/fixtures/architecture-baseline.json`），只许减少。剩余 8 条都需要设计决策，不硬改：
  - `schedule/service → supervisor`（定时触发任务）和 `→ muse`（读注意力）：等 KX-72 任务契约定型后，
    让 schedule 只发「业务事件」，由组合根订阅启动任务。
  - `workforce/service → supervisor`（子任务完成推进父任务的动态 import）：`finishAgentTask` 在 web / worker / desktop 三种进程里都会跑，
    注册表化要保证三处都注册，KX-72 一起处理。
  - `desktop-runtime/service → workforce`、`product-development/* → advisor`、`cost-engine → work`、`evidence → governance`：
    四条属于领域间引用，评估后放到 KX-74 或后续架构小步。
- 运行时最大模块环 14 个（含类型 18），目标 ≤ 3。worker 已完全脱环；下一批目标是 schedule、connectors、playbooks。
- 本机测试数据库：`D:/pgsql17`（PG17，端口 5432），DB 测试前 `set -a; . /d/pgsql17/ci.env; set +a`；
  仓库 `.env` 里的 5433 是旧 Mac 配置。用 `powershell Start-Process pg_ctl … start` 启动才不会随终端一起退出。

## 5. 校验记录

- tsc 0；改动文件 eslint 0。
- `test:architecture` 11 / 11、`test:source-guards` 61 / 61、`test:regression-units` 254 / 254（新增 `kern-capability-directory` 4 条）、
  `test:delivery-contracts` 全过、`test:kern-autonomy` 16 / 16、`test:kern-supervisor-plan` 46 / 46。
- DB 回归 10 套（worker、kern-worker-recovery、schedule、supervisor、playbook、brief、takeaway、mission-controls、node-ask、connector-approval）全过。
- 权限矩阵 `test:authz`：见 §10 日志（本页写完时仍在跑）。
