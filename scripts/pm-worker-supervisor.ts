/**
 * PM Worker 守护进程（KX-34b）：让 Worker 常驻。
 *
 *   npm run worker:supervised            # 崩溃自动重启（1s→2s→…→60s 退避，稳定 5 分钟后清零）
 *   npm run worker:supervised -- --quiet # 其余参数原样传给 worker
 *
 * - 已有活跃 Worker（退出码 75）→ 每 30s 再试一次，不抢占也不刷屏；
 * - Ctrl+C / SIGTERM → 转发给 Worker，等它跑完当前轮再退出；
 * - 生产环境也可以用 systemd / pm2 / 容器 restart=always 取代本脚本，行为等价。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { localBin } from "./lib/local-bin";
import { decideAfterExit } from "../src/modules/worker/supervisor-policy";

const passthrough = process.argv.slice(2).filter((a) => a !== "--once");
let child: ChildProcess | null = null;
let stopping = false;
let crashes = 0;
let timer: NodeJS.Timeout | null = null;

function log(message: string) {
  console.log(`[pm-supervisor ${new Date().toISOString()}] ${message}`);
}

function start() {
  timer = null;
  const [cmd, args] = localBin("tsx", ["scripts/pm-worker.ts", ...passthrough]);
  const startedAt = Date.now();
  child = spawn(cmd, args, { stdio: "inherit", env: process.env });
  log(`Worker 已启动 pid=${child.pid}`);
  child.on("exit", (code, signal) => {
    child = null;
    const decision = decideAfterExit({ code, stopping, uptimeMs: Date.now() - startedAt, crashes });
    if (decision.action === "stop") {
      log("Worker 已退出，守护进程结束");
      process.exit(0);
    }
    crashes = decision.crashes;
    log(`Worker 退出（code=${code ?? "null"} signal=${signal ?? "-"}），${Math.round(decision.delayMs / 1000)}s 后重启${crashes ? `（连续第 ${crashes} 次）` : "（已有活跃实例，等待）"}`);
    timer = setTimeout(start, decision.delayMs);
  });
}

function shutdown(sig: NodeJS.Signals) {
  if (stopping) return;
  stopping = true;
  if (timer) {
    clearTimeout(timer);
    log("收到退出信号，守护进程结束");
    process.exit(0);
  }
  log(`收到 ${sig}，通知 Worker 跑完当前轮后退出…`);
  child?.kill(sig);
  // Windows 上信号转发不可靠：给 30s 宽限，超时强制结束。
  setTimeout(() => {
    child?.kill("SIGKILL");
    process.exit(0);
  }, 30_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
log(`守护进程 pid=${process.pid}`);
start();
