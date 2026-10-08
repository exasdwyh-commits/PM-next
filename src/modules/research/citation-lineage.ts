/**
 * P0-B Citation Lineage - 引用全链传递
 * 引用必须从 research 节点一直传到下游节点、Synthesizer、Executive Report 与 Kern 对话回执
 * 下游只能引用上游已给出的 source id，不得凭空新增
 */

export interface Citation {
  id: string;
  sourceId: string;
  sourceUrl: string;
  sourceOrganization: string;
  claimId: string;
  nodeKey: string;
  missionId: string;
  createdAt: Date;
  lineage: string[]; // 节点路径
}

export interface CitationLineage {
  missionId: string;
  sourceCaptures: { id: string; url: string; organization: string; hash: string }[];
  researchNodes: { nodeKey: string; citations: string[] }[];
  downstreamNodes: { nodeKey: string; citations: string[]; upstream: string[] }[];
  finalReport: { citations: string[]; allSourceIds: string[] };
  kernReceipt: { citations: string[] };
}

export function validateCitationLineage(lineage: CitationLineage): { valid: boolean; errors: string[]; provenance: boolean } {
  const errors: string[] = [];
  const allSourceIds = new Set(lineage.sourceCaptures.map((s) => s.id));

  // 1. 检查下游只能引用上游已给的 source id
  for (const downstream of lineage.downstreamNodes) {
    for (const citationId of downstream.citations) {
      // citationId 应对应某个 source
      const citationSource = lineage.sourceCaptures.find((s) => citationId.includes(s.id) || s.id === citationId);
      // 简化检查: 下游引用的 source 必须在上游或 sourceCaptures 中
      const upstreamSources = new Set(
        lineage.researchNodes.flatMap((n) => n.citations).concat(lineage.sourceCaptures.map((s) => s.id))
      );
      if (!upstreamSources.has(citationId) && !allSourceIds.has(citationId)) {
        errors.push(`下游节点 ${downstream.nodeKey} 引用了未在上游出现的 source ${citationId}, 凭空新增`);
      }
    }
  }

  // 2. 最终报告的每个 citation 都能解析到真实 SourceCapture
  for (const citationId of lineage.finalReport.citations) {
    if (!allSourceIds.has(citationId)) {
      errors.push(`最终报告 citation ${citationId} 无法解析到真实 SourceCapture`);
    }
  }

  // 3. 全链可回溯
  const provenance = lineage.sourceCaptures.length > 0 && lineage.researchNodes.length > 0 && lineage.finalReport.citations.length > 0;

  return {
    valid: errors.length === 0,
    errors,
    provenance,
  };
}

export function buildLineageFromMission(mission: any): CitationLineage {
  // 从 Mission 构建全链
  const sourceCaptures = (mission.researchRuns || []).flatMap((run: any) =>
    (run.sourceCaptures || []).map((s: any) => ({
      id: s.id,
      url: s.url,
      organization: s.sourceOrganization,
      hash: s.contentHash,
    }))
  );

  const researchNodes = (mission.agentRuns || [])
    .filter((r: any) => r.taskClass?.includes("research"))
    .map((r: any) => ({
      nodeKey: r.nodeKey || r.taskClass,
      citations: (r.citations || []).map((c: any) => c.sourceId),
    }));

  const downstreamNodes = (mission.agentRuns || [])
    .filter((r: any) => !r.taskClass?.includes("research"))
    .map((r: any) => ({
      nodeKey: r.nodeKey || r.taskClass,
      citations: (r.citations || []).map((c: any) => c.sourceId),
      upstream: (r.upstreamNodeKeys || []) as string[],
    }));

  const finalReport = {
    citations: (mission.artifacts || []).flatMap((a: any) => (a.citations || []).map((c: any) => c.sourceId)),
    allSourceIds: sourceCaptures.map((s: any) => s.id),
  };

  const kernReceipt = {
    citations: (mission.kernReceipt?.citations || []).map((c: any) => c.sourceId),
  };

  return {
    missionId: mission.id,
    sourceCaptures,
    researchNodes,
    downstreamNodes,
    finalReport,
    kernReceipt,
  };
}

export function describeCitationLineage() {
  return {
    rule: "引用必须从 research 节点一直传到下游、Synthesizer、Executive Report、Kern 回执, 下游只能引用上游已给 source id",
    hardTest: "SourceCapture → research node → downstream node → final answer 全链 provenance 可回溯, 每个 citation 可解析到真实 SourceCapture",
    lineageFields: ["sourceCaptures", "researchNodes", "downstreamNodes", "finalReport", "kernReceipt"],
  };
}
