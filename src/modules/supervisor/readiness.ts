import prisma from "@/shared/db";
import type { SessionContext } from "@/modules/identity/session";
import { getUsage } from "@/modules/usage";
import { getWorkerHealth } from "@/modules/worker/heartbeat";
import { isMissionNodeModelReady } from "./generic-executor";
import { getWebSearch } from "./web-search";
import { detectCompetitorResearch, competitorSubject } from "./competitor-brief";
import type { MissionPlan } from "./plan";

export interface MissionReadiness {
  ready: boolean;
  demoReady: boolean;
  checkedAt: string;
  blockers: { code: string; message: string }[];
  warnings: string[];
}

/** Read configuration and current admission conditions; never call an external provider. */
export async function getMissionReadiness(
  session: SessionContext,
  plan: MissionPlan,
  /**
   * Task-level intent, decided from the original request rather than from the
   * assembled plan text. Omitted → falls back to scanning plan.goal, which is
   * only safe when the plan is known not to carry clarifying answers.
   */
  intent?: { competitorResearch?: boolean },
): Promise<MissionReadiness> {
  const codes = [...new Set(["hermes_pm", ...plan.nodes.map(n => n.agentCode)])];
  const [agents, beats, usage, models] = await Promise.all([
    prisma.agent.findMany({ where: { organizationId: session.organizationId, code: { in: codes } }, select: { code: true, status: true } }),
    getWorkerHealth(new Date(), { organizationId: session.organizationId, loop: "executor" }),
    getUsage(session.organizationId),
    Promise.all(plan.nodes.map(async n => ({ key: n.key, ready: await isMissionNodeModelReady(session.organizationId, n.agentCode, n.taskClass) }))),
  ]);
  const blockers: MissionReadiness["blockers"] = [];
  const competitorResearch = intent?.competitorResearch ?? detectCompetitorResearch(plan.goal);
  if (competitorResearch && !competitorSubject(plan.goal)) blockers.push({ code: "INPUT", message: "请先填写要调研的品牌或产品" });
  const active = new Set(agents.filter(a => a.status === "ACTIVE").map(a => a.code));
  const absent = codes.filter(code => !active.has(code));
  if (absent.length) blockers.push({ code: "TEAM", message: "计划所需团队成员未初始化或已停用，请在团队设置中检查" });
  if (beats.status !== "running") blockers.push({ code: "WORKER", message: "后台执行器未运行或心跳已过期，请联系管理员启动" });
  if (models.some(m => !m.ready)) blockers.push({ code: "MODEL", message: "部分步骤没有符合策略的已配置模型，请检查模型设置" });
  const suppliedPages = /https?:\/\//i.test(plan.goal) && process.env.KERN_WEB_FETCH !== "off";
  if (competitorResearch && !getWebSearch() && !suppliedPages) blockers.push({ code: "SEARCH", message: "竞品调研需要网页检索，请配置检索服务或提供资料链接" });
  if ((usage.limits.missionsPerMonth !== null && usage.used.missions >= usage.limits.missionsPerMonth)
    || (usage.limits.modelCallsPerMonth !== null && usage.used.modelCalls >= usage.limits.modelCallsPerMonth)) {
    blockers.push({ code: "USAGE", message: "已达到本部署的月度安全上限，请联系管理员调整" });
  }
  return { ready: blockers.length === 0, demoReady: !blockers.some(b => ["INPUT", "TEAM", "WORKER"].includes(b.code)),
    checkedAt: new Date().toISOString(), blockers,
    warnings: ["检查仅确认配置和当前运行状态；外部服务连通性会在执行时验证。"],
  };
}
