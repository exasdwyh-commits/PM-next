# 科恩 KERN · Brand & Naming Contract

## Product identity

- 中文名：**科恩**
- English wordmark：**KERN**
- Product role：**AI 工作总管 / AI Chief of Staff**
- Core promise：用户说目标，科恩理解上下文，组织数字员工与本机执行能力持续推进；只有在关键业务决策、授权或高风险动作时请求人工介入。

## User-facing naming

所有用户可见界面、演示、截图、销售材料与新产品文档统一使用：

- 对话称呼：**科恩**
- 品牌 / wordmark：**KERN**
- 桌面执行层：**KERN Desktop Runtime**
- 数字员工体系：**KERN Workforce**
- 运行追溯：**KERN Trace**
- 长期记忆：**KERN Memory**
- 远程控制：**KERN Remote**

不要再把 **Hermes** 或 **Muse** 作为产品名展示给用户。

## Compatibility names

以下标识目前属于技术兼容层，**本轮刻意不做破坏性重命名**：

- repository / package 历史命名，例如 `hermes-next`
- 路由 `/muse`
- 数据库 / Workforce code，例如 `HERMES_PM`
- 前端协议值，例如 `e-hermes`、message author `hermes`
- 环境变量 `HERMES_*`
- 脚本 / LaunchAgent / 日志历史命名，例如 `hermes-desktop`
- CSS class，例如 `.hermes-*`
- 历史文档文件名，例如 `HERMES_DESKTOP_RUNTIME.md`

这些名称可以继续存在于实现内部，但不得重新泄漏到新的用户可见文案。

## Migration rule

1. **Display first**：先统一 UI、Metadata、演示数据、主文档。
2. **Compatibility preserved**：不因为品牌改名破坏数据库、API、脚本、安装器或历史自动化。
3. **New code uses KERN**：新增用户可见模块统一采用 KERN 命名；只有扩展既有兼容接口时才允许继续使用 legacy Hermes/Muse identifier。
4. **Technical rename later**：若未来决定清理内部命名，必须单独立项，提供数据库 / env / CLI / route alias 与回滚策略，不与产品功能开发混在一起。

## Voice

科恩不是“聊天机器人”。

它应被描述为一个长期驻留的 AI 工作总管：

```text
你给目标
→ 科恩理解上下文
→ 研究 / 拆解 / 委派
→ 数字员工与本机 Runtime 执行
→ Evidence / QA / Governance 复核
→ 需要时找你决策
→ 决策后继续推进
```

文案优先使用“我来推进 / 需要你确认 / 已派给… / 依据是… / 当前缺口是…”，避免把内部 Agent、Workflow、Run、lease、fencing token 等实现术语暴露给普通用户。
