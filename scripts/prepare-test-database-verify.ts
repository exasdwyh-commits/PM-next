import { spawnSync } from "node:child_process";
import { localBin } from "./lib/local-bin";

/** `spawnSync` 的可观测结果（真实实现与测试注入用同一形状）。 */
export interface DiffRunResult {
  status: number | null;
  stdout?: string | null;
  stderr?: string | null;
  error?: Error | null;
}

export type DiffRunner = (args: readonly string[], env: NodeJS.ProcessEnv) => DiffRunResult;

/** 默认实现：用仓库本地 prisma 入口跑 `migrate diff`（见 scripts/lib/local-bin.ts）。 */
export const defaultDiffRunner: DiffRunner = (args, env) => {
  const [cmd, cmdArgs] = localBin("prisma", args);
  const res = spawnSync(cmd, cmdArgs, { encoding: "utf8", env });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, error: res.error ?? undefined };
};

/**
 * 结构比对：实库 vs `schema.prisma`。
 *
 * 用 `prisma migrate diff --from-url <库> --to-schema-datamodel <schema> --exit-code`：
 *   exit 0 → 无差异（结构已验证）；exit 2 → 有差异；其它非 0 → 工具/连接错误。
 * **任何非 0 都判为「未验证」**——宁可说未验证，不许说已验证。
 *
 * 这条规则是 TASK-004 的核心不变量，因此抽成可注入依赖的纯函数：
 * 让测试能直接喂 0 / 1 / 2 / status null，而不是靠改真实库结构来造场景。
 * runner 可注入只影响「怎么跑命令」，不影响「怎么解读退出码」。
 */
export function verifyStructureMatchesSchema(
  dbUrl: string,
  runner: DiffRunner = defaultDiffRunner
): { ok: boolean; detail: string } {
  let res: DiffRunResult;
  try {
    res = runner(
      ["migrate", "diff", "--from-url", dbUrl, "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"],
      { ...process.env, DATABASE_URL: dbUrl }
    );
  } catch (error) {
    // runner 自己抛（例如本地 prisma 入口不存在）同样算「未验证」，
    // 不能让异常冒泡到 getState 成为一次不带结论的崩溃。
    return { ok: false, detail: `无法运行 prisma：${error instanceof Error ? error.message : String(error)}` };
  }
  // 进程没能启动（res.error）时也要给出原因，不能只留下一句空的「结构未通过」。
  const detail = [res.error ? `无法运行 prisma：${res.error.message}` : "", res.stdout ?? "", res.stderr ?? ""]
    .join("")
    .trim();
  return { ok: res.status === 0, detail };
}
