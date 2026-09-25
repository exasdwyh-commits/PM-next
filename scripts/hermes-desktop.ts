#!/usr/bin/env tsx
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  DesktopAction,
  DesktopRuntimeResult,
  DesktopTaskEnvelope,
} from "../src/modules/desktop-runtime/contracts";

const execFileAsync = promisify(execFile);
const HOME = os.homedir();
const BASE_URL = (process.env.HERMES_BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const EMAIL = process.env.HERMES_DESKTOP_EMAIL?.trim() || "";
const DEVICE_ID =
  process.env.HERMES_DESKTOP_DEVICE_ID?.trim() ||
  os.hostname() + "-" + String(process.getuid?.() ?? "user");
const POLL_MS = Math.max(1000, Number(process.env.HERMES_DESKTOP_POLL_MS || "2500"));
const MAX_OUTPUT = Math.max(4096, Number(process.env.HERMES_DESKTOP_MAX_OUTPUT || "32768"));
const WORKSPACE = expandPath(process.env.HERMES_DESKTOP_WORKSPACE || process.cwd());
const ALLOW_DANGEROUS = process.env.HERMES_DESKTOP_ALLOW_DANGEROUS === "1";
const ALLOW_APPLESCRIPT = process.env.HERMES_DESKTOP_ALLOW_APPLESCRIPT === "1";

const allowedRoots = (
  process.env.HERMES_DESKTOP_ALLOWED_ROOTS
    ? process.env.HERMES_DESKTOP_ALLOWED_ROOTS.split(",")
    : [
        process.cwd(),
        path.join(HOME, "Desktop"),
        path.join(HOME, "Documents"),
        path.join(HOME, "Downloads"),
      ]
)
  .map((p) => path.resolve(expandPath(p.trim())))
  .filter(Boolean);

let cookie = "";
let stopping = false;

function expandPath(value: string): string {
  const text = value.trim();
  if (text === "~") return HOME;
  if (text.startsWith("~/")) return path.join(HOME, text.slice(2));
  return path.resolve(text);
}

function short(value: string): string {
  return value.length <= MAX_OUTPUT
    ? value
    : value.slice(0, MAX_OUTPUT) + "\n…[truncated]";
}

function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function assertAllowedPath(value: string): string {
  const resolved = path.resolve(expandPath(value));
  if (!allowedRoots.some((root) => isWithin(root, resolved))) {
    throw new Error(
      "Path is outside allowed roots: " +
        resolved +
        ". Configure HERMES_DESKTOP_ALLOWED_ROOTS to expand access."
    );
  }
  return resolved;
}

function assertSafeShell(command: string) {
  if (ALLOW_DANGEROUS) return;
  const blocked = [
    /\bsudo\b/i,
    /\brm\s+-[^\n]*r[^\n]*f\b/i,
    /\bdiskutil\s+(?:erase|partition|secureErase)/i,
    /\bmkfs\b/i,
    /\bshutdown\b/i,
    /\breboot\b/i,
    /:\(\)\s*\{\s*:\|:&\s*\};:/,
  ];
  if (blocked.some((rule) => rule.test(command))) {
    throw new Error(
      "Command matched the desktop dangerous-command guard. " +
        "Set HERMES_DESKTOP_ALLOW_DANGEROUS=1 only when you explicitly want unrestricted shell execution."
    );
  }
}

async function runFile(
  file: string,
  args: string[],
  options: { cwd?: string; timeout?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  const cwd = options.cwd ? assertAllowedPath(options.cwd) : WORKSPACE;
  const result = await execFileAsync(file, args, {
    cwd,
    timeout: options.timeout ?? 120_000,
    maxBuffer: 8 * 1024 * 1024,
    env: process.env,
  });
  return {
    stdout: short(String(result.stdout ?? "")),
    stderr: short(String(result.stderr ?? "")),
  };
}

async function runShell(command: string, cwd?: string) {
  assertSafeShell(command);
  return runFile("/bin/zsh", ["-lc", command], {
    cwd: cwd || WORKSPACE,
    timeout: 10 * 60_000,
  });
}

async function keychainPassword(): Promise<string> {
  if (process.env.HERMES_DESKTOP_PASSWORD) return process.env.HERMES_DESKTOP_PASSWORD;
  if (process.platform !== "darwin" || !EMAIL) return "";
  try {
    const result = await execFileAsync(
      "/usr/bin/security",
      ["find-generic-password", "-s", "Hermes PM-next", "-a", EMAIL, "-w"],
      { timeout: 10_000, maxBuffer: 64 * 1024 }
    );
    return String(result.stdout).trim();
  } catch {
    return "";
  }
}

async function login() {
  if (!EMAIL) throw new Error("HERMES_DESKTOP_EMAIL is required");
  const password = await keychainPassword();
  if (!password) {
    throw new Error(
      "No desktop password found. Set HERMES_DESKTOP_PASSWORD or run scripts/install-hermes-desktop.sh."
    );
  }

  const res = await fetch(BASE_URL + "/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password }),
  });
  if (!res.ok) {
    throw new Error(
      "Hermes login failed: HTTP " + res.status + " " + (await res.text())
    );
  }
  const setCookie = res.headers.get("set-cookie");
  const pair = setCookie?.split(";")[0];
  if (!pair) throw new Error("Hermes login did not return a session cookie");
  cookie = pair;
}

async function api<T>(
  url: string,
  init: RequestInit = {},
  retryAuth = true
): Promise<T> {
  if (!cookie) await login();
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookie);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(BASE_URL + url, { ...init, headers });
  if (res.status === 401 && retryAuth) {
    cookie = "";
    await login();
    return api<T>(url, init, false);
  }
  const raw = await res.text();
  if (!res.ok) {
    throw new Error("HTTP " + res.status + ": " + raw.slice(0, 1000));
  }
  return (raw ? JSON.parse(raw) : {}) as T;
}

async function executeCodex(
  goal: string,
  cwd?: string
): Promise<DesktopRuntimeResult> {
  const targetCwd = assertAllowedPath(cwd || WORKSPACE);
  const custom = process.env.HERMES_DESKTOP_AGENT_COMMAND?.trim();

  try {
    if (custom) {
      const result = await execFileAsync("/bin/zsh", ["-lc", custom], {
        cwd: targetCwd,
        timeout: 30 * 60_000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, HERMES_DESKTOP_GOAL: goal },
      });
      const output = short(
        [result.stdout, result.stderr].filter(Boolean).join("\n")
      );
      return {
        ok: true,
        summary: "本机 Agent 已完成任务。",
        output,
      };
    }

    const result = await runFile(
      "codex",
      [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        goal,
      ],
      { cwd: targetCwd, timeout: 30 * 60_000 }
    );
    const output = short([result.stdout, result.stderr].filter(Boolean).join("\n"));
    return {
      ok: true,
      summary: "Codex 已在本机工作区完成任务。",
      output,
      meta: { agent: "codex", cwd: targetCwd },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT|not found/i.test(message)) {
      return {
        ok: false,
        summary:
          "本机没有找到 Codex CLI。安装并登录 Codex，或设置 HERMES_DESKTOP_AGENT_COMMAND 使用其他本机 Agent。",
        output: message,
      };
    }
    return {
      ok: false,
      summary: "本机 Agent 执行失败：" + message,
    };
  }
}

async function executeAction(
  action: DesktopAction
): Promise<DesktopRuntimeResult> {
  switch (action.tool) {
    case "fs.list": {
      const target = assertAllowedPath(action.path);
      const names = await fs.readdir(target, { withFileTypes: true });
      const output = names
        .slice(0, 500)
        .map((entry) => (entry.isDirectory() ? "d " : "- ") + entry.name)
        .join("\n");
      return {
        ok: true,
        summary: "已列出 " + target + "（" + names.length + " 项）。",
        output: short(output),
        artifacts: [{ kind: "directory", path: target }],
      };
    }

    case "fs.read_text": {
      const target = assertAllowedPath(action.path);
      const stat = await fs.stat(target);
      if (stat.size > 2 * 1024 * 1024) {
        throw new Error("Refusing to read text file larger than 2 MB in one desktop action");
      }
      const output = await fs.readFile(target, "utf8");
      return {
        ok: true,
        summary: "已读取 " + target + "。",
        output: short(output),
        artifacts: [{ kind: "file", path: target }],
      };
    }

    case "fs.write_text": {
      const target = assertAllowedPath(action.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      if (action.append) await fs.appendFile(target, action.content, "utf8");
      else await fs.writeFile(target, action.content, "utf8");
      return {
        ok: true,
        summary: "已" + (action.append ? "追加" : "写入") + "文件 " + target + "。",
        artifacts: [{ kind: "file", path: target }],
      };
    }

    case "fs.mkdir": {
      const target = assertAllowedPath(action.path);
      await fs.mkdir(target, { recursive: true });
      return {
        ok: true,
        summary: "已创建目录 " + target + "。",
        artifacts: [{ kind: "directory", path: target }],
      };
    }

    case "fs.move": {
      const from = assertAllowedPath(action.from);
      const to = assertAllowedPath(action.to);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
      return {
        ok: true,
        summary: "已移动 " + from + " → " + to + "。",
        artifacts: [{ kind: "file", path: to }],
      };
    }

    case "shell.run": {
      const result = await runShell(action.command, action.cwd);
      return {
        ok: true,
        summary: "终端命令执行完成：" + action.command.slice(0, 120),
        output: short([result.stdout, result.stderr].filter(Boolean).join("\n")),
      };
    }

    case "git.status": {
      const result = await runFile("git", ["status", "--short", "--branch"], {
        cwd: action.cwd || WORKSPACE,
      });
      return {
        ok: true,
        summary: "已读取 Git 状态。",
        output: short([result.stdout, result.stderr].filter(Boolean).join("\n")),
      };
    }

    case "git.diff": {
      const result = await runShell("git diff --stat && git diff", action.cwd);
      return {
        ok: true,
        summary: "已读取 Git diff。",
        output: short([result.stdout, result.stderr].filter(Boolean).join("\n")),
      };
    }

    case "browser.open": {
      const parsed = new URL(action.url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("Only HTTP(S) URLs are allowed");
      }
      const opener = process.platform === "darwin" ? "open" : "xdg-open";
      await execFileAsync(opener, [parsed.toString()], { timeout: 15_000 });
      return {
        ok: true,
        summary: "已在默认浏览器打开 " + parsed.toString() + "。",
        artifacts: [{ kind: "url", url: parsed.toString() }],
      };
    }

    case "app.open": {
      if (process.platform !== "darwin") {
        throw new Error("app.open currently requires macOS");
      }
      await execFileAsync("open", ["-a", action.app], { timeout: 15_000 });
      return {
        ok: true,
        summary: "已打开应用：" + action.app + "。",
      };
    }

    case "clipboard.read": {
      if (process.platform !== "darwin") {
        throw new Error("clipboard.read currently requires macOS");
      }
      const result = await execFileAsync("pbpaste", [], {
        timeout: 10_000,
        maxBuffer: 2 * 1024 * 1024,
      });
      return {
        ok: true,
        summary: "已读取剪贴板。",
        output: short(String(result.stdout)),
      };
    }

    case "clipboard.write": {
      if (process.platform !== "darwin") {
        throw new Error("clipboard.write currently requires macOS");
      }
      await new Promise<void>((resolve, reject) => {
        const child = execFile("pbcopy", [], (error) =>
          error ? reject(error) : resolve()
        );
        child.stdin?.end(action.text);
      });
      return {
        ok: true,
        summary: "已写入剪贴板。",
      };
    }

    case "notification.send": {
      if (process.platform !== "darwin") {
        throw new Error("notification.send currently requires macOS");
      }
      const title = action.title || "Hermes";
      const script =
        "display notification " +
        JSON.stringify(action.body) +
        " with title " +
        JSON.stringify(title);
      await execFileAsync("osascript", ["-e", script], { timeout: 10_000 });
      return {
        ok: true,
        summary: "已发送 macOS 通知。",
      };
    }

    case "mac.applescript": {
      if (process.platform !== "darwin") {
        throw new Error("mac.applescript requires macOS");
      }
      if (!ALLOW_APPLESCRIPT) {
        return {
          ok: false,
          summary:
            "AppleScript 自动化默认关闭。需要操作没有 API 的桌面应用时，设置 HERMES_DESKTOP_ALLOW_APPLESCRIPT=1，并在 macOS 授予辅助功能权限。",
        };
      }
      const result = await execFileAsync("osascript", ["-e", action.script], {
        timeout: 2 * 60_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      return {
        ok: true,
        summary: "AppleScript 执行完成。",
        output: short([result.stdout, result.stderr].filter(Boolean).join("\n")),
      };
    }

    case "agent.delegate":
      return executeCodex(action.goal, action.cwd);
  }
}

async function finish(
  taskId: string,
  runId: string,
  outcome: "SUCCEEDED" | "FAILED" | "BLOCKED" | "WAITING_HUMAN",
  result: DesktopRuntimeResult
) {
  await api(
    "/api/desktop-runtime/tasks/" + encodeURIComponent(taskId) + "/finish",
    {
      method: "POST",
      body: JSON.stringify({
        deviceId: DEVICE_ID,
        runId,
        outcome,
        result,
      }),
    }
  );
}

async function handleTask(task: DesktopTaskEnvelope) {
  if (
    task.status === "RUNNING" &&
    task.claim &&
    task.claim.deviceId === DEVICE_ID
  ) {
    await finish(task.taskId, task.claim.runId, "WAITING_HUMAN", {
      ok: false,
      summary:
        "Desktop Runtime restarted while this task was RUNNING. It was not replayed automatically because the previous action may already have produced side effects.",
    });
    return;
  }

  const claim = await api<{
    taskId: string;
    action: DesktopAction;
    runId: string;
    resumed: boolean;
  }>(
    "/api/desktop-runtime/tasks/" +
      encodeURIComponent(task.taskId) +
      "/claim",
    {
      method: "POST",
      body: JSON.stringify({ deviceId: DEVICE_ID }),
    }
  );

  console.log(
    "[desktop] executing " +
      task.taskId +
      " " +
      claim.action.tool +
      ": " +
      task.goal
  );

  let result: DesktopRuntimeResult;
  try {
    result = await executeAction(claim.action);
  } catch (error) {
    result = {
      ok: false,
      summary: error instanceof Error ? error.message : String(error),
    };
  }

  const outcome = result.ok
    ? "SUCCEEDED"
    : /默认关闭|没有找到 Codex CLI|requires macOS/.test(result.summary)
      ? "WAITING_HUMAN"
      : "FAILED";

  await finish(task.taskId, claim.runId, outcome, result);
  console.log(
    "[desktop] " + outcome + " " + task.taskId + ": " + result.summary
  );
}

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return {
    once: args.has("--once") || args.has("-1"),
    printTools: args.has("--print-tools"),
  };
}

async function main() {
  const args = parseArgs();

  if (args.printTools) {
    console.log(
      [
        "fs.list",
        "fs.read_text",
        "fs.write_text",
        "fs.mkdir",
        "fs.move",
        "shell.run",
        "git.status",
        "git.diff",
        "browser.open",
        "app.open",
        "clipboard.read",
        "clipboard.write",
        "notification.send",
        "mac.applescript",
        "agent.delegate",
      ].join("\n")
    );
    return;
  }

  await login();
  console.log("[desktop] Hermes Desktop Runtime online device=" + DEVICE_ID);
  console.log("[desktop] server=" + BASE_URL + " workspace=" + WORKSPACE);
  console.log("[desktop] roots=" + allowedRoots.join(", "));

  do {
    const data = await api<{ tasks: DesktopTaskEnvelope[] }>(
      "/api/desktop-runtime/tasks?deviceId=" +
        encodeURIComponent(DEVICE_ID) +
        "&limit=3"
    );

    for (const task of data.tasks) {
      if (stopping) break;
      try {
        await handleTask(task);
      } catch (error) {
        console.error(
          "[desktop] task " +
            task.taskId +
            " failed before completion:",
          error instanceof Error ? error.message : error
        );
      }
    }

    if (args.once) break;
    if (!stopping) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  } while (!stopping);
}

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

main().catch((error) => {
  console.error(
    "[desktop] fatal:",
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
});
