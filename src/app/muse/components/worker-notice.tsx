"use client";
/** KX-34b：后台执行服务（Worker）没在运行时明确告诉用户——任务推进和定时都依赖它。 */
import { useEffect, useState } from "react";

type Health = { status: "running" | "stale" | "stopped" | "never" };

export function WorkerNotice({ active, what = "这项工作" }: { active: boolean; what?: string }) {
  const [status, setStatus] = useState<Health["status"] | null>(null);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const load = () =>
      fetch("/api/worker/health", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<Health>) : null))
        .then((d) => { if (live && d) setStatus(d.status); })
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 30_000);
    return () => { live = false; clearInterval(timer); };
  }, [active]);
  if (!active || !status || status === "running") return null;
  return (
    <p className="m-ws-notice" data-t="warn" role="status" data-worker={status}>
      后台执行服务没在运行，{what}暂时不会推进；恢复后会从断点继续，进度不会丢。
      <span className="m-quiet">（部署者：运行 <code>npm run worker:supervised</code>）</span>
    </p>
  );
}
