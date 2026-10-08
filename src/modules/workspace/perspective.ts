export type WorkPerspective = "leadership" | "product" | "sales";
export const WORK_PERSPECTIVES: { value: WorkPerspective; label: string; focus: string }[] = [
  { value: "leadership", label: "负责人", focus: "待决策、执行进度与阻断" },
  { value: "product", label: "产品研发", focus: "研发工作、证据缺口与验证" },
  { value: "sales", label: "销售经营", focus: "成本情景、证据与交付进度" },
];
export function readPerspective(value: unknown): WorkPerspective {
  return value === "product" || value === "sales" ? value : "leadership";
}
export function perspectiveStorageKey(organizationId: string, userId: string) {
  return `kern.work-perspective.v1:${encodeURIComponent(organizationId)}:${encodeURIComponent(userId)}`;
}
export interface ProjectTaskView { id: string; title: string; status: string; dependencies?: unknown }
/** Completion means accepted delivery; submission/running never count as completed. */
export function projectTaskSnapshot(tasks: ProjectTaskView[]) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const rows = tasks.map(task => {
    const raw = task.dependencies;
    const invalidDependencies = raw != null && (!Array.isArray(raw) || raw.some(id => typeof id !== "string"));
    const dependencies = Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === "string"))] : [];
    const missing = dependencies.filter(id => !byId.has(id));
    const waiting = dependencies.filter(id => byId.has(id) && byId.get(id)!.status !== "ACCEPTED");
    return { ...task, dependencies, missing, waiting, invalidDependencies,
      blocked: task.status === "TODO" && (invalidDependencies || missing.length > 0 || waiting.length > 0) };
  });
  return { rows, total: tasks.length, accepted: tasks.filter(task => task.status === "ACCEPTED").length,
    running: tasks.filter(task => task.status === "RUNNING").length,
    blocked: rows.filter(task => task.blocked).length };
}
