"use client";
import { projectTaskSnapshot, type ProjectTaskView, type WorkPerspective } from "@/modules/workspace/perspective";
import { labelWorkItemStatus } from "@/shared/status-labels";
type Destination = "tasks" | "evidence" | "decisions" | "cost" | "rnd";
export function ProjectBrief({ tasks, gaps, verifiedEvidence, totalEvidence, decisions, role, hasRnd, onOpen }: {
  tasks: ProjectTaskView[]; gaps: string[]; verifiedEvidence: number; totalEvidence: number; decisions: number;
  role: WorkPerspective; hasRnd: boolean; onOpen: (destination: Destination) => void;
}) {
  const snapshot = projectTaskSnapshot(tasks);
  const action: { title: string; detail: string; label: string; destination: Destination } = role === "sales"
    ? { title: "先看成本，再判断经营空间", detail: "用实际报价建立成本情景，比较单件成本、利润与供货价。预设费率可按真实情况调整。", label: "测算成本情景", destination: "cost" }
    : role === "leadership" && decisions > 0
      ? { title: `${decisions} 项决策等待你审查`, detail: "先核对依据与风险，再决定是否推进。项目进度以验收通过的交付为准。", label: "审查待决策事项", destination: "decisions" }
      : gaps.length > 0
        ? { title: "先补齐依据，再推进下一阶段", detail: `当前诊断列出 ${gaps.length} 项研发 / 决策缺口。请核对证据与批准条件。`, label: "检查证据与缺口", destination: "evidence" }
        : { title: hasRnd ? "查看研发交付与验证结果" : "安排下一项可验收的工作", detail: "当前诊断未列出缺口。继续推进仍需核对最新证据和正式门禁结果。", label: hasRnd ? "查看 AI 研发" : "查看工作项", destination: hasRnd ? "rnd" : "tasks" };
  const metrics: { destination: Destination; title: string; value: string | number; detail: string }[] = [
    { destination: "tasks", title: "已验收 / 全部工作项", value: `${snapshot.accepted} / ${snapshot.total}`, detail: `${snapshot.running} 项执行中 · 提交不等于验收` },
    { destination: "evidence", title: "已核实证据", value: verifiedEvidence, detail: `共 ${totalEvidence} 条记录` },
    { destination: "decisions", title: "待审决策", value: decisions, detail: "查看依据、风险与批准条件" },
  ];
  if (role === "product") metrics.unshift(metrics.splice(1, 1)[0]);
  if (role === "leadership") metrics.unshift(metrics.pop()!);
  return <section className="kern-project-brief" aria-label="项目工作简报">
    <div className="kern-next-action"><div><span className="kern-eyebrow">当前重点</span><h2>{action.title}</h2><p>{action.detail}</p></div>
      <button type="button" className="hermes-primary-btn" onClick={() => onOpen(action.destination)}>{action.label}<span aria-hidden>→</span></button>
    </div>
    <div className="kern-brief-stats">{metrics.map(card => <button type="button" key={card.title} onClick={() => onOpen(card.destination)}>
      <span>{card.title}</span><strong>{card.value}</strong><small>{card.detail}</small><span className="kern-metric-arrow" aria-hidden>↗</span>
    </button>)}</div>
    <div className="kern-project-columns">
      <section className="kern-project-progress" aria-label="交付进度">
        <div className="kern-brief-heading"><h3>交付进度</h3><span>{snapshot.accepted} / {snapshot.total} 已验收</span></div>
        <progress max={snapshot.total || 1} value={snapshot.accepted} aria-label="已验收工作项" />
        <p>{snapshot.blocked > 0 ? `${snapshot.blocked} 个待办的依赖尚未满足。` : snapshot.total ? "工作项按实际验收状态统计。" : "尚未建立工作项，先定义目标与交付要求。"}</p>
        {snapshot.total > 0 && <details className="kern-task-details"><summary>工作项与前置依赖（{snapshot.total}）</summary>
          <ol className="kern-task-flow">{snapshot.rows.map(task => <li className="kern-task-row" key={task.id} data-status={task.status}>
            <div className="kern-task-title"><strong>{task.title}</strong><span>{labelWorkItemStatus(task.status)}</span></div>
            <small>{task.invalidDependencies ? "依赖格式异常，请检查工作项。" : task.dependencies.length === 0 ? "未设置前置依赖" : `前置：${task.dependencies.map(id => {
              const dependency = tasks.find(item => item.id === id);
              return dependency ? `${dependency.title}（${labelWorkItemStatus(dependency.status)}）` : "工作项缺失 / 不可见";
            }).join("；")}`}</small>
          </li>)}</ol>
        </details>}
      </section>
      <section className="kern-project-gaps" aria-label="推进前需确认">
        <div className="kern-brief-heading"><h3>推进前需确认</h3><span>{gaps.length} 项缺口</span></div>
        {gaps.length > 0 ? <ul>{gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul> : <p>当前诊断未列出缺口。是否批准，以最新证据与正式决策为准。</p>}
      </section>
    </div>
  </section>;
}
