export const DESKTOP_AGENT_CODE = "desktop_operator";

export type DesktopAction =
  | { tool: "fs.list"; path: string }
  | { tool: "fs.read_text"; path: string }
  | { tool: "fs.write_text"; path: string; content: string; append?: boolean }
  | { tool: "fs.mkdir"; path: string }
  | { tool: "fs.move"; from: string; to: string }
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
  artifacts?: Array<{
    kind: "file" | "directory" | "url" | "text";
    path?: string;
    url?: string;
    label?: string;
  }>;
  meta?: Record<string, unknown>;
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

  const write = input.match(
    /(?:写入|保存到|写到)(?:文件)?(?:[:：\s]+)([~./][^\s，。；;]+)\s+(?:内容[:：]?\s*)?([\s\S]+)$/i
  );
  if (write?.[1] && write?.[2]) {
    return {
      tool: "fs.write_text",
      path: cleanQuoted(write[1]),
      content: cleanQuoted(write[2]),
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
