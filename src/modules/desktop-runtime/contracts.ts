export const DESKTOP_AGENT_CODE = "desktop_operator";

export type DesktopAction =
  | { tool: "fs.list"; path: string }
  | { tool: "fs.read_text"; path: string }
  | {
      tool: "fs.write_text";
      path: string;
      content: string;
      /** 追加到末尾，不动已有内容 */
      append?: boolean;
      /** 用户显式要求覆盖已有文件；缺省时目标已存在会停下等人 */
      overwrite?: boolean;
    }
  | { tool: "fs.mkdir"; path: string }
  | {
      tool: "fs.move";
      from: string;
      to: string;
      /** 用户显式要求覆盖已存在的目标；缺省时目标已存在会停下等人 */
      overwrite?: boolean;
    }
  | { tool: "shell.run"; command: string; cwd?: string }
  | { tool: "git.status"; cwd?: string }
  | { tool: "git.diff"; cwd?: string }
  | { tool: "browser.open"; url: string }
  | { tool: "app.open"; app: string }
  | { tool: "clipboard.read" }
  | { tool: "clipboard.write"; text: string }
  | { tool: "notification.send"; title?: string; body: string }
  | { tool: "mac.applescript"; script: string }
  | { tool: "agent.delegate"; goal: string; cwd?: string };

export interface DesktopTaskEnvelope {
  taskId: string;
  goal: string;
  action: DesktopAction;
  status: string;
  createdAt: string;
  claim?: {
    deviceId: string;
    runId: string;
    claimedAt: string;
  } | null;
}

export interface DesktopRuntimeResult {
  ok: boolean;
  summary: string;
  output?: string;
  /** 没有失败，但需要用户决定才能继续（执行端据此回报 WAITING_HUMAN） */
  needsHuman?: boolean;
  artifacts?: Array<{
    kind: "file" | "directory" | "url" | "text";
    path?: string;
    url?: string;
    label?: string;
  }>;
  meta?: Record<string, unknown>;
}

/**
 * 把结构化动作翻译成用户能复核的一句话。
 * UI 不应该把 `fs.write_text` 这种工具标识直接摆给老板看 —— 用户要判断的是
 * 「Hermes 准备在我电脑上干什么」，而不是内部工具名。
 * 同时必须把真实参数（路径、命令、网址）显示出来，否则用户无法复核就等于无法授权。
 */
export function describeDesktopAction(action: DesktopAction): {
  /** 动作类别，短标签 */
  kind: string;
  /** 具体要做什么，含真实参数 */
  detail: string;
} {
  switch (action.tool) {
    case "fs.list":
      return { kind: "读取目录", detail: action.path };
    case "fs.read_text":
      return { kind: "读取文件", detail: action.path };
    case "fs.write_text":
      return {
        kind: action.append ? "追加写入文件" : action.overwrite ? "覆盖写入文件" : "写入文件",
        detail: action.path,
      };
    case "fs.mkdir":
      return { kind: "创建目录", detail: action.path };
    case "fs.move":
      return {
        kind: action.overwrite ? "覆盖移动文件" : "移动文件",
        detail: `${action.from} → ${action.to}`,
      };
    case "shell.run":
      return {
        kind: "执行命令",
        detail: action.cwd ? `${action.command}（在 ${action.cwd}）` : action.command,
      };
    case "git.status":
      return { kind: "查看 Git 状态", detail: action.cwd || "当前工作目录" };
    case "git.diff":
      return { kind: "查看 Git 变更", detail: action.cwd || "当前工作目录" };
    case "browser.open":
      return { kind: "打开网页", detail: action.url };
    case "app.open":
      return { kind: "启动应用", detail: action.app };
    case "clipboard.read":
      return { kind: "读取剪贴板", detail: "读取当前剪贴板内容" };
    case "clipboard.write":
      return { kind: "写入剪贴板", detail: action.text.slice(0, 120) };
    case "notification.send":
      return { kind: "发送系统通知", detail: action.body.slice(0, 120) };
    case "mac.applescript":
      return { kind: "运行 AppleScript", detail: action.script.slice(0, 120) };
    case "agent.delegate":
      return {
        kind: "交给本机 Agent（Codex）",
        detail: action.cwd ? `${action.goal}（在 ${action.cwd}）` : action.goal,
      };
    default: {
      // 新增工具忘记在这里登记时，如实说未知，不要猜一个好看的说法。
      const unknown = action as { tool?: string };
      return {
        kind: "未登记的本机动作",
        detail: typeof unknown.tool === "string" ? unknown.tool : "未知",
      };
    }
  }
}

const EXPLICIT_DESKTOP_CUE =
  /(?:本机|电脑上|电脑里|Mac上|macOS|桌面助理|Finder|终端(?:里|中|执行)?|剪贴板|浏览器打开|打开网址|执行命令|运行命令|用\s*Codex|让\s*Codex|git\s+(?:status|diff))/i;

const PATH_CUE = /(?:~\/|\/Users\/|\.\/|\.\.\/|\/Volumes\/)/;

export function isDesktopInstruction(text: string): boolean {
  return EXPLICIT_DESKTOP_CUE.test(text) || PATH_CUE.test(text);
}

function cleanQuoted(value: string): string {
  return value
    .trim()
    .replace(/^[「『“"'\`]+/, "")
    .replace(/[」』”"'\`]+$/, "")
    .trim();
}

function extractCwd(text: string): string | undefined {
  const m = text.match(/(?:在|进入)\s*([~./][^，。；;]+?)\s*(?:目录|文件夹|仓库)?(?:里|中)?(?:执行|运行|做|让|$)/i);
  return m?.[1] ? cleanQuoted(m[1]) : undefined;
}

/**
 * 桌面动作解析器：只把明确、可复核的指令编译成具体 Tool。
 * 更开放的“帮我在电脑上完成 X”走 agent.delegate，由本机 Agent 在受限工作区内完成。
 */
export function parseDesktopInstruction(text: string): DesktopAction | null {
  const input = text.trim();
  if (!input || !isDesktopInstruction(input)) return null;

  if (/(?:读取|查看|看看|取出).{0,6}剪贴板/.test(input)) {
    return { tool: "clipboard.read" };
  }

  const clipWrite = input.match(/(?:复制|写入|放到).{0,6}剪贴板(?:[:：\s]+)([\s\S]+)$/);
  if (clipWrite?.[1]) {
    return { tool: "clipboard.write", text: cleanQuoted(clipWrite[1]) };
  }

  const notify = input.match(/(?:通知我|发个通知|系统通知)(?:[:：\s]+)([\s\S]+)$/);
  if (notify?.[1]) {
    return {
      tool: "notification.send",
      title: "Hermes",
      body: cleanQuoted(notify[1]),
    };
  }

  const url = input.match(/https?:\/\/[^\s，。；;]+/i)?.[0];
  if (url && /(?:打开|浏览器|访问|网址)/.test(input)) {
    return { tool: "browser.open", url };
  }

  if (/git\s+status/i.test(input)) {
    return { tool: "git.status", cwd: extractCwd(input) };
  }
  if (/git\s+diff/i.test(input)) {
    return { tool: "git.diff", cwd: extractCwd(input) };
  }

  const shell = input.match(/(?:执行命令|运行命令|终端(?:里|中)?执行|终端(?:里|中)?运行)(?:[:：\s]+)([\s\S]+)$/i);
  if (shell?.[1]) {
    return {
      tool: "shell.run",
      command: cleanQuoted(shell[1]),
      cwd: extractCwd(input),
    };
  }

  const list = input.match(/(?:列出|查看|看看)(?:目录|文件夹)(?:[:：\s]+)([~./][^，。；;]+)$/i);
  if (list?.[1]) {
    return { tool: "fs.list", path: cleanQuoted(list[1]) };
  }

  const read = input.match(/(?:读取|查看|打开)(?:文件)(?:[:：\s]+)([~./][^，。；;]+)$/i);
  if (read?.[1]) {
    return { tool: "fs.read_text", path: cleanQuoted(read[1]) };
  }

  const mkdir = input.match(/(?:新建|创建)(?:目录|文件夹)(?:[:：\s]+)([~./][^，。；;]+)$/i);
  if (mkdir?.[1]) {
    return { tool: "fs.mkdir", path: cleanQuoted(mkdir[1]) };
  }

  const move = input.match(
    /(覆盖)?(?:移动|移到|挪动)(?:文件|目录|文件夹)?(?:[:：\s]+)([~./][^\s，。；;]+)\s*(?:到|至|→|->)\s*([~./][^\s，。；;]+)\s*$/i
  );
  if (move?.[2] && move?.[3]) {
    return {
      tool: "fs.move",
      from: cleanQuoted(move[2]),
      to: cleanQuoted(move[3]),
      ...(move[1] ? { overwrite: true } : {}),
    };
  }

  // 「覆盖写入」「追加到」是用户对已有内容的显式授权；普通「写入」遇到已存在的文件会停下等人。
  const write = input.match(
    /(覆盖写入|覆盖保存到|覆盖写到|追加写入|追加到|写入|保存到|写到)(?:文件)?(?:[:：\s]+)([~./][^\s，。；;]+)\s+(?:内容[:：]?\s*)?([\s\S]+)$/i
  );
  if (write?.[2] && write?.[3]) {
    return {
      tool: "fs.write_text",
      path: cleanQuoted(write[2]),
      content: cleanQuoted(write[3]),
      ...(write[1].startsWith("覆盖") ? { overwrite: true } : {}),
      ...(write[1].startsWith("追加") ? { append: true } : {}),
    };
  }

  const app = input.match(/(?:打开|启动)(?:应用|App|软件)?(?:[:：\s]+)([^，。；;]+)$/i);
  if (app?.[1] && !app[1].includes("/") && !/^https?:/i.test(app[1])) {
    return { tool: "app.open", app: cleanQuoted(app[1]) };
  }

  // 明确说“本机 / Mac / Codex”等但无法安全编译成单一原子工具时，
  // 交给本机已配置 Agent 处理，而不是在服务端猜 shell 命令。
  return {
    tool: "agent.delegate",
    goal: input,
    cwd: extractCwd(input),
  };
}

/**
 * 本机危险命令黑名单（执行端 scripts/hermes-desktop.ts 调用）。
 *
 * 黑名单天然不完备，只是最后一道兜底；受保护动作的正路是 human gate
 * （见 governance/protected-actions.ts 的 DESKTOP_TOOL_RISK）。放在这里而不是执行端，
 * 是为了能被单测覆盖——此前的 `rm\s+-…r…f\b` 写法漏掉了 `rm -fr`，
 * 却会误拦 `rm -r report.pdf`（f 出现在文件名末尾）。
 */
const DANGEROUS_SHELL_PATTERNS: readonly RegExp[] = [
  /\bsudo\b/i,
  /\bdiskutil\s+(?:erase|partition|secureErase)/i,
  /\bmkfs\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
];

/** `rm` 同时带递归与强制（任意顺序、合并或分开、长短选项、命令替换内）。 */
function hasRecursiveForceRm(command: string): boolean {
  const normalized = command.replace(/[`$(){}"'\\]/g, " ");
  for (const segment of normalized.split(/[;&|\n]+/)) {
    const tokens = segment.trim().split(/\s+/);
    const at = tokens.findIndex((t) => t === "rm" || t.endsWith("/rm"));
    if (at < 0) continue;
    let recursive = false;
    let force = false;
    for (const token of tokens.slice(at + 1)) {
      if (token === "--") break;
      if (token === "--recursive") recursive = true;
      else if (token === "--force") force = true;
      else if (/^-[A-Za-z]+$/.test(token)) {
        if (/[rR]/.test(token)) recursive = true;
        if (/[fF]/.test(token)) force = true;
      }
    }
    if (recursive && force) return true;
  }
  return false;
}

export function isDangerousShellCommand(command: string): boolean {
  return (
    hasRecursiveForceRm(command) ||
    DANGEROUS_SHELL_PATTERNS.some((rule) => rule.test(command))
  );
}

/** 执行端发现目标已存在时的现状描述（由 desktop-runtime/local-fs.ts 产生）。 */
export interface ExistingDesktopTarget {
  path: string;
  kind: "file" | "directory" | "other";
  size: number;
  modifiedAt: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} 字节`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 覆盖保护的等人回执：不改动任何内容，告诉用户现状，并给出可以原样照说的确认指令
 * （这些指令由 parseDesktopInstruction 解析为带 overwrite / append 的动作，有单测锁定）。
 */
export function overwriteConfirmationResult(
  action: Extract<DesktopAction, { tool: "fs.write_text" | "fs.move" }>,
  existing: ExistingDesktopTarget
): DesktopRuntimeResult {
  const what = existing.kind === "directory" ? "目录" : existing.kind === "file" ? "文件" : "条目";
  const facts = `现有${what}：${existing.path}，${formatSize(existing.size)}，最后修改 ${existing.modifiedAt.replace("T", " ").slice(0, 16)} UTC`;
  if (action.tool === "fs.write_text") {
    return {
      ok: false,
      needsHuman: true,
      summary: `没有写入：${action.path} 已存在，直接写入会覆盖原${what}。`,
      output: [
        facts,
        "",
        `要替换原文件，请说：本机覆盖写入 ${action.path} <内容>`,
        `只想加在末尾，请说：本机追加到 ${action.path} <内容>`,
      ].join("\n"),
    };
  }
  return {
    ok: false,
    needsHuman: true,
    summary: `没有移动：目标 ${action.to} 已存在，移动会覆盖它。`,
    output: [
      facts,
      "",
      `要覆盖目标，请说：本机覆盖移动 ${action.from} 到 ${action.to}`,
      "或者换一个目标路径重新交代。",
    ].join("\n"),
  };
}

/** 执行结果 → 回报给服务端的 outcome。 */
export function desktopOutcomeFor(
  result: DesktopRuntimeResult
): "SUCCEEDED" | "WAITING_HUMAN" | "FAILED" {
  if (result.ok) return "SUCCEEDED";
  // 旧文案匹配保留兼容：AppleScript 关闭 / 未安装 Codex / 非 macOS 属于「需要人处理」而非失败。
  if (result.needsHuman || /默认关闭|没有找到 Codex CLI|requires macOS/.test(result.summary)) {
    return "WAITING_HUMAN";
  }
  return "FAILED";
}
