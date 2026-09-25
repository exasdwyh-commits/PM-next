# KERN Desktop Runtime

KERN Desktop Runtime 把 PM-next 的 Department Assistant 与用户自己的 Mac 连接起来。

目标不是再做一个“桌面聊天壳”，而是让同一个科恩：

```text
对话提出目标
→ PM-next 建立 AgentTask / AgentRun
→ desktop_operator 把任务交给指定 Mac
→ Mac 执行真实文件 / Shell / Git / Browser / App / Clipboard / Codex 工作
→ 结果写回原 AgentTask / AgentRun
→ 原科恩对话自动出现结果
```

这意味着 PM-next 仍是唯一任务与审计真相源，本机 Runtime 只是执行层。

> 品牌说明：对外统一使用 **科恩 KERN**。当前 `HERMES_DESKTOP_*` 环境变量、`hermes-desktop` 脚本名、LaunchAgent 标识与本文件名属于兼容接口，本轮不做破坏性重命名。新增用户可见文案不得继续使用 Hermes。

## 已交付能力

当前 Runtime 支持：

- 文件：列目录、读文本、写文本、建目录、移动文件；
- Terminal：执行受控 shell 命令；
- Git：status / diff；
- Browser：用默认浏览器打开 HTTP(S) URL；
- macOS App：启动指定 App；
- Clipboard：读取、写入剪贴板；
- macOS Notification：发送系统通知；
- AppleScript：可选启用，用于有系统自动化接口的 App；
- Local Agent：把开放式本机任务交给 Codex CLI；也可通过环境变量替换为 Claude Code 或其他本机 Agent。

默认的开放式本机 Agent 调用为：

```bash
codex exec --skip-git-repo-check --sandbox workspace-write "<goal>"
```

如果你希望换成其他 Agent，可以设置：

```bash
export HERMES_DESKTOP_AGENT_COMMAND='your-agent-command "$HERMES_DESKTOP_GOAL"'
```

用户目标不会被拼进 shell 命令本身，而是放在 `HERMES_DESKTOP_GOAL` 环境变量里。

## 一次安装

前提：

1. PM-next 已经能启动，或者有一个可访问的 PM-next 部署地址；
2. Mac 已安装 Node.js / npm；
3. PM-next 中已有可登录账号；
4. 若要使用 Codex 执行开放式任务，Mac 上需要安装并登录 Codex CLI。

在 PM-next 仓库根目录执行：

```bash
npm run desktop:install
```

安装器会：

- 缺少依赖时自动执行 `npm ci`；
- 询问 PM-next 登录邮箱；
- 把登录密码放进 macOS Keychain，而不是写进配置文件；
- 创建 `~/.config/hermes-desktop/config.env`；
- 创建 LaunchAgent：
  `~/Library/LaunchAgents/com.hermes.pm-next.desktop.plist`；
- 登录后常驻运行；
- 自动重连 PM-next；
- 日志写到 `~/Library/Logs/Hermes/`。

默认连接：

```text
http://127.0.0.1:3100
```

如果 PM-next 部署在其他机器或云端：

```bash
HERMES_BASE_URL=https://your-hermes.example.com npm run desktop:install
```

## 开始使用

安装后，不需要进入“数字员工”页面操作 Desktop Operator。

直接在 AI 助理里说：

```text
本机帮我执行 git status，并把结果告诉我
```

或者：

```text
读取剪贴板
```

```text
浏览器打开 https://github.com
```

```text
读取文件 ~/Desktop/brief.md
```

```text
终端执行 npm test
```

开放式任务：

```text
本机帮我检查当前代码仓库，把能确定的 bug 修掉，跑完测试后告诉我结果
```

这类不能安全编译成单一原子动作的任务会进入 `agent.delegate`，默认交给 Codex 在 `workspace-write` sandbox 中执行。

## 工作区与文件权限

默认允许目录：

- 当前 PM-next 仓库；
- `~/Desktop`；
- `~/Documents`；
- `~/Downloads`。

通过安装器安装时，配置的 Desktop Workspace 也会加入允许目录。

要改变范围：

```bash
export HERMES_DESKTOP_ALLOWED_ROOTS="$HOME/Desktop,$HOME/Documents,/path/to/repos"
```

Runtime 会对文件动作和默认工作目录做 realpath 范围检查。未在 allowed roots 中的路径会被拒绝。

## Shell 与高风险动作

桌面助理是本机执行器，因此“能执行”不代表应该默许所有不可逆动作。

默认 shell guard 拒绝明显高风险命令，例如：

- `sudo`
- `rm -rf`
- 磁盘擦除/格式化
- shutdown / reboot
- fork bomb

只有用户明确选择无限制本机执行时才设置：

```bash
export HERMES_DESKTOP_ALLOW_DANGEROUS=1
```

这是运行时权限开关，不是模型提示词。模型不能自己解除。

## AppleScript / GUI 自动化

默认关闭。

需要控制支持 AppleScript / Accessibility 的 App 时：

1. 给运行 Runtime 的终端/Node 进程授予 macOS Accessibility 权限；
2. 在 `~/.config/hermes-desktop/config.env` 加：

```bash
export HERMES_DESKTOP_ALLOW_APPLESCRIPT=1
```

3. 重启 LaunchAgent。

当前交付版已经具备 AppleScript 执行通道，但没有假装已经具备完整的屏幕视觉 Computer Use。纯视觉识别、坐标点击、拖拽等仍需要后续接入专门的 Computer Use 驱动时才应宣称支持。

## 回执与防重复执行

Desktop Runtime 复用 PM-next 原生：

- AgentTask
- AgentRun
- status
- audit
- ownership
- concurrency

任务领取后会写入：

```json
{
  "desktopClaim": {
    "deviceId": "...",
    "runId": "...",
    "claimedAt": "..."
  }
}
```

完成后写回：

```json
{
  "desktopResult": {
    "ok": true,
    "summary": "...",
    "output": "...",
    "deviceId": "...",
    "finishedAt": "..."
  }
}
```

如果 Runtime 在任务 RUNNING 时崩溃并重启，它不会自动重放这个动作，因为上一次动作可能已经产生副作用。该任务会进入 `WAITING_HUMAN`，避免“重启一次又重复删/写/提交一次”。

## 多 Mac

每台 Mac 有自己的 `deviceId`。

默认值：

```text
<hostname>-<uid>
```

可以显式设置：

```bash
export HERMES_DESKTOP_DEVICE_ID=office-mac
```

已经被一台设备 claim 的 RUNNING 任务不会被另一台设备接管。

## 账号隔离

Runtime 用 PM-next 正常登录会话访问接口。

队列只返回：

- 当前 organization；
- 当前登录 user 创建；
- `desktop_operator`；
- QUEUED 或该 device 自己 claim 的 RUNNING 任务。

也就是说，一台个人 Mac 不会因为同组织里另一个人创建了桌面任务就替对方执行。

## 手工运行与诊断

前台运行：

```bash
npm run desktop
```

只跑一轮：

```bash
npm run desktop:once
```

列出工具：

```bash
npm run desktop -- --print-tools
```

LaunchAgent 状态：

```bash
launchctl print gui/$UID/com.hermes.pm-next.desktop
```

日志：

```bash
tail -f ~/Library/Logs/Hermes/desktop.log
tail -f ~/Library/Logs/Hermes/desktop-error.log
```

## 交付验收

静态/契约：

```bash
npm run test:desktop-runtime
npm run typecheck
npm run lint
npm run build
```

本机真机 Smoke Test：

1. 启动 PM-next；
2. 安装 Desktop Runtime；
3. AI 助理发送“读取剪贴板”；
4. 页面应先显示“已发送到 Mac 执行队列”；
5. Runtime claim；
6. AgentTask / AgentRun 进入 RUNNING；
7. Runtime 完成；
8. AgentTask / AgentRun 正确终结；
9. 原 AI 助理会话自动出现“本机任务已完成”和真实剪贴板结果。

同样可用 `git status` 和读取一个临时文本文件做无破坏验证。
