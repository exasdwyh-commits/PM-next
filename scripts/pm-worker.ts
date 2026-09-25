/**
 * PM Worker 进程入口。
 *
 * 用法：
 *   npm run worker                      # 常驻：四个 loop 按各自周期推进
 *   npm run worker -- --once            # 单次：每 loop 跑一轮后退出（cron/测试友好）
 *   npm run worker -- --loops=executor  # 只跑指定 loop
 *   npm run worker -- --executor-batch=1 --quiet
 *
 * 设计说明见 docs/DIGITAL_EMPLOYEE_EXECUTOR_DESIGN.md。
 * 单实例：默认用 `.pm-worker/lock.json` 文件锁 + 心跳；`--ignore-lock` 可跳过（测试）。
 */
import { loadEnvFiles } from "../src/shared/env";

loadEnvFiles();

const DEFAULT_LOOP_NAMES = ["executor", "research", "event", "reconcile"] as const;
type LoopName = (typeof DEFAULT_LOOP_NAMES)[number];

interface CliOptions {
  once: boolean;
  quiet: boolean;
  ignoreLock: boolean;
  loops?: LoopName[];
  executorBatch?: number;
  maxTicks?: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    once: false,
    quiet: false,
    ignoreLock: false,
  };
  for (const raw of argv) {
    const arg = raw.trim();
    if (!arg) continue;
    if (arg === "--once" || arg === "-1") {
      options.once = true;
      continue;
    }
    if (arg === "--quiet" || arg === "-q") {
      options.quiet = true;
      continue;
    }
    if (arg === "--ignore-lock") {
      options.ignoreLock = true;
      continue;
    }
    if (arg.startsWith("--loops=")) {
      const names = arg
        .slice("--loops=".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const invalid = names.filter(
        (name) => !DEFAULT_LOOP_NAMES.includes(name as LoopName)
      );
      if (invalid.length) {
        throw new Error(
          `未知 loop: ${invalid.join(", ")}（可选 ${DEFAULT_LOOP_NAMES.join("/")}）`
        );
      }
      options.loops = names as LoopName[];
      continue;
    }
    if (arg.startsWith("--executor-batch=")) {
      options.executorBatch = Number(arg.slice("--executor-batch=".length));
      continue;
    }
    if (arg.startsWith("--max-ticks=")) {
      options.maxTicks = Number(arg.slice("--max-ticks=".length));
      continue;
    }
    throw new Error(`未知参数：${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  // 动态导入：确保 loadEnvFiles() 先于任何读取 DATABASE_URL 的模块执行。
  const { runPmWorker } = await import("../src/modules/worker");

  const summary = await runPmWorker({
    once: options.once,
    quiet: options.quiet,
    ignoreLock: options.ignoreLock,
    loops: options.loops,
    executorBatch: options.executorBatch,
    maxTicks: options.maxTicks,
  });

  if (options.once) {
    const totals = Object.entries(summary.results).map(([loop, result]) => ({
      loop,
      acted: result?.acted ?? 0,
      errors: result?.errors ?? 0,
    }));
    console.log(
      `[pm-worker] 单轮完成：${totals
        .map((row) => `${row.loop}=${row.acted}${row.errors ? `(err ${row.errors})` : ""}`)
        .join(" ")}`
    );
  } else {
    console.log(
      `[pm-worker] 退出（${summary.stoppedBy}，共 ${summary.ticks} 轮）`
    );
  }
}

main()
  .catch((error) => {
    console.error("[pm-worker] 启动失败：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const prisma = (await import("../src/shared/db")).default;
    await prisma.$disconnect().catch(() => {});
  });
