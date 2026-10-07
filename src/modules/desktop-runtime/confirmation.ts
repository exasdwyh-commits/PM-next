/**
 * KX-35 本机动作分级确认（纯函数，不碰 DB）
 * =========================================
 *
 * 以前 shell.run / agent.delegate 只靠执行端的 isDangerousShellCommand 黑名单挡，
 * 黑名单天然不完备。现在服务端在入队前先分级：
 *
 *   AUTO    只读单条命令（ls / git status …）与其它非 UNBOUNDED 工具：照旧直接排队
 *   CONFIRM 其余 shell.run、所有 agent.delegate：任务停在 WAITING_HUMAN，
 *           用户在确认卡上看到完整命令与目录，点「允许一次」才签发单次 ApprovalGrant
 *   DENY    命中 isDangerousShellCommand：服务端直接拒绝，不入队
 *
 * 允许一次 = 一张绑定 actionHash 的单次凭据；执行端 claim 时服务端核验并消耗，
 * 动作被改过（hash 不符）或凭据已用过都会被拒。
 */
import crypto from "node:crypto";
import { isDangerousShellCommand, type DesktopAction } from "./contracts";

export type DesktopConfirmPolicy = "AUTO" | "CONFIRM" | "DENY";

export interface DesktopConfirmDecision {
  policy: DesktopConfirmPolicy;
  /** 给用户看的中文原因（AUTO 时为 null） */
  reason: string | null;
}

/** 受分级确认约束的工具（其余工具不在 KX-35 范围内，行为不变）。 */
export const CONFIRMABLE_DESKTOP_TOOLS = ["shell.run", "agent.delegate"] as const;

/** 只放行完整匹配的读取命令；未知参数、脚本和 shell 展开均需确认。 */
const READ_ONLY_COMMANDS: ReadonlyArray<RegExp> = [
  /^(pwd|whoami)$/,
  /^ls(?: -(?:l|a|la|al))?$/,
  /^git status(?: --short)?(?: --branch)?$/,
  /^git diff --stat$/,
  /^git log -[1-9][0-9]?$/,
  /^git branch(?: --list)?$/,
  /^git remote -v$/,
];

const SHELL_COMPOSITION = /[;&|<>`\n\r$\\]/;

export function isReadOnlyShellCommand(command: string): boolean {
  const cmd = command.trim();
  if (!cmd || SHELL_COMPOSITION.test(cmd)) return false;
  return READ_ONLY_COMMANDS.some((rule) => rule.test(cmd));
}

export function classifyDesktopAction(action: DesktopAction): DesktopConfirmDecision {
  switch (action.tool) {
    case "shell.run": {
      if (isDangerousShellCommand(action.command)) {
        return {
          policy: "DENY",
          reason: "命中危险命令规则（如 sudo、rm -rf、磁盘格式化等），Kern 不会在你的电脑上执行它",
        };
      }
      if (isReadOnlyShellCommand(action.command)) return { policy: "AUTO", reason: null };
      return {
        policy: "CONFIRM",
        reason: SHELL_COMPOSITION.test(action.command)
          ? "这条命令包含管道、重定向或多条命令组合，执行前需要你确认"
          : "这条命令可能修改你电脑上的文件或状态，执行前需要你确认",
      };
    }
    case "agent.delegate":
      return {
        policy: "CONFIRM",
        reason: "本机 Agent（Codex）会自主读写该目录下的文件，每次交给它之前都需要你确认",
      };
    default:
      return { policy: "AUTO", reason: null };
  }
}

/** 规范化动作 → sha256；确认卡批准的就是这个指纹，动作改一个字符都会失效。 */
export function desktopActionHash(action: DesktopAction): string {
  const entries = Object.entries(action as unknown as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b));
  return crypto.createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

/** ApprovalGrant 的 capability / resource 绑定。 */
export function desktopGrantScope(taskId: string, action: DesktopAction) {
  return {
    taskRef: `desktop:${taskId}`,
    capability: action.tool === "shell.run" ? "shell.exec" : `desktop.${action.tool}`,
    resource: "cwd" in action && action.cwd ? action.cwd : "(default-root)",
    actionHash: desktopActionHash(action),
  };
}

/** 允许一次的有效期：批准后 1 小时内必须被执行端领取，否则需重新确认。 */
export const DESKTOP_GRANT_TTL_MS = 60 * 60 * 1000;

export interface DesktopConfirmationState {
  policy: "CONFIRM";
  reason: string;
  actionHash: string;
  requestedAt: string;
  status: "PENDING" | "APPROVED" | "DENIED";
  grantId: string | null;
  decidedAt: string | null;
  decidedByUserId: string | null;
}

export function readDesktopConfirmation(snapshot: unknown): DesktopConfirmationState | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const raw = (snapshot as Record<string, unknown>).desktopConfirmation;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.policy !== "CONFIRM" || typeof r.actionHash !== "string") return null;
  const status = r.status === "APPROVED" || r.status === "DENIED" ? r.status : "PENDING";
  return {
    policy: "CONFIRM",
    reason: typeof r.reason === "string" ? r.reason : "",
    actionHash: r.actionHash,
    requestedAt: typeof r.requestedAt === "string" ? r.requestedAt : "",
    status,
    grantId: typeof r.grantId === "string" ? r.grantId : null,
    decidedAt: typeof r.decidedAt === "string" ? r.decidedAt : null,
    decidedByUserId: typeof r.decidedByUserId === "string" ? r.decidedByUserId : null,
  };
}
