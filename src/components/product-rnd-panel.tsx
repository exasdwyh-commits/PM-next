"use client";

import * as React from "react";
import { Badge, Button, Empty, Panel, Thinking } from "@/components/ui";
import { ExecutiveReportView } from "@/components/executive-report";
import { identityHeaders } from "@/shared/client-identity";
import type { ExecutiveReportPayload } from "@/shared/executive-report-types";

/**
 * AI 产品研发（数字员工流水线）面板
 * =================================
 *
 * 之前项目页里已经存在 START / RECONCILE 的处理函数与状态，但**从未渲染**——
 * 属于死代码，负责人根本看不到产品研发流水线，更看不到后端已经合成的管理报告。
 * 本组件把这段能力真正接上，并挂上 Executive Report Renderer。
 *
 * 职责边界：
 * - 只负责「展示状态 + 发 START/RECONCILE/QUEUE_QA 指令」；
 * - 不自己推进工作流——推进是 pm-worker 后台 loop 的职责（关掉浏览器也在跑）；
 *   页面上的 RECONCILE 只是给负责人一个「立刻对齐一次」的手动入口。
 */

const TASK_LABELS: Record<string, string> = {
  research_agent: "市场与竞品",
  scientific_evidence_agent: "科学证据",
  formulation_agent: "配方与规格",
  compliance_agent: "法规与宣称",
  cost_bom_agent: "成本与 BOM",
  qa_verifier: "独立 QA",
};

interface ProductRndTaskRow {
  id: string;
  agentCode: string;
  agentName: string;
  status: string;
  latestRun: {
    id: string;
    status: string;
    outputSummary: string | null;
    errorReason: string | null;
  } | null;
}

interface ProductRndStatusResponse {
  workItem: { id: string; status: string; inputRevision: number };
  parentTaskId: string | null;
  tasks: ProductRndTaskRow[];
  latestReport:
    | ({
        id: string;
        title: string;
        contentVersion: number;
        createdAt: string;
        preview: ExecutiveReportPayload | null;
      })
    | null;
}

export function ProductRndPanel({
  projectId,
  workItemId,
  mockAuth,
  activeUserId,
  canOperate,
  onChanged,
  onNotice,
}: {
  projectId: string;
  workItemId: string;
  mockAuth: boolean;
  activeUserId?: string;
  canOperate: boolean;
  onChanged?: () => void | Promise<void>;
  onNotice?: (text: string, type: "ok" | "error") => void;
}) {
  const [status, setStatus] = React.useState<ProductRndStatusResponse | null>(null);
  const [brief, setBrief] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [started, setStarted] = React.useState(false);

  const headers = React.useMemo(
    () => identityHeaders(mockAuth, activeUserId),
    [mockAuth, activeUserId]
  );

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/product-rnd?workItemId=${encodeURIComponent(
          workItemId
        )}`,
        { headers }
      );
      if (!res.ok) throw new Error(`读取产品研发状态失败（HTTP ${res.status}）`);
      const data = (await res.json()) as ProductRndStatusResponse;
      setStatus(data);
    } catch (error) {
      onNotice?.(
        error instanceof Error ? error.message : "读取产品研发状态失败",
        "error"
      );
    } finally {
      setLoading(false);
    }
  }, [headers, onNotice, projectId, workItemId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const call = React.useCallback(
    async (body: Record<string, unknown>, successText: string) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/product-rnd`, {
          method: "POST",
          headers: identityHeaders(mockAuth, activeUserId, {
            "Content-Type": "application/json",
          }),
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { message?: string }).message ||
              `请求失败（HTTP ${res.status}）`
          );
        }
        await load();
        await onChanged?.();
        onNotice?.(successText, "ok");
      } catch (error) {
        onNotice?.(
          error instanceof Error ? error.message : "请求失败",
          "error"
        );
      } finally {
        setBusy(false);
      }
    },
    [activeUserId, load, mockAuth, onChanged, onNotice, projectId]
  );

  const parentTaskId = status?.parentTaskId ?? null;
  const tasks = status?.tasks ?? [];
  const report = status?.latestReport?.preview ?? null;
  const notStarted = started === false && !parentTaskId && tasks.length === 0;

  return (
    <Panel
      eyebrow="AI 产品研发"
      icon="automation"
      title="数字员工流水线"
      sub="市场与竞品 / 科学证据 / 配方与规格 / 法规与宣称 / 成本与 BOM 五路专业分工，加独立 QA 与结构化管理报告。"
      actions={
        <div className="hermes-inline">
          {parentTaskId && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !canOperate}
              onClick={() =>
                void call(
                  { action: "RECONCILE", parentTaskId },
                  "已重新对齐一次产品研发状态"
                )
              }
            >
              立即对齐
            </Button>
          )}
        </div>
      }
    >
      {loading ? (
        <Thinking label="读取产品研发状态…" />
      ) : notStarted ? (
        <div>
          <div className="hermes-section-label">启动产品研发评估</div>
          <textarea
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            rows={3}
            placeholder="填写本次产品研发目标（人群、品类、约束、期望产出…）"
            style={{ width: "100%", marginBottom: 8 }}
          />
          <Button
            disabled={busy || !canOperate || !brief.trim()}
            onClick={() =>
              void call({ action: "START", brief: brief.trim() }, "AI 产品研发已启动").then(
                () => setStarted(true)
              )
            }
          >
            启动产品研发
          </Button>
          {!canOperate && (
            <p className="hermes-row-meta" style={{ marginTop: 6 }}>
              只有项目负责人/决策人可以启动。
            </p>
          )}
        </div>
      ) : (
        <div>
          <div className="hermes-section-label">
            五路专业任务与独立 QA（{tasks.length}）
          </div>
          {tasks.length === 0 ? (
            <Empty title="还没有专业任务">
              点上面的「立即对齐」让后台重新派生一次任务。
            </Empty>
          ) : (
            <ul className="hermes-list">
              {tasks.map((task) => (
                <li key={task.id} className="hermes-row is-flat">
                  <span className="hermes-row-body">
                    <strong>
                      {TASK_LABELS[task.agentCode] || task.agentName}
                    </strong>{" "}
                    <Badge status={task.status}>{task.status}</Badge>
                    <div className="hermes-row-meta" style={{ lineHeight: 1.7 }}>
                      {task.latestRun?.outputSummary ||
                        task.latestRun?.errorReason ||
                        "（等待后台 Worker 执行）"}
                    </div>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div style={{ marginTop: 16 }}>
            <ExecutiveReportView report={report} />
          </div>

          <p className="hermes-row-meta" style={{ marginTop: 10, lineHeight: 1.7 }}>
            后台 Worker（<code>npm run worker</code>）会持续推进这些任务：关掉浏览器
            也不会停。页面上的「立即对齐」只是手动催一次。独立 QA 完成后报告自动落盘；
            没有真实数据的专业任务会诚实地停在 BLOCKED 并列出缺口，而不是编造数字。
          </p>
        </div>
      )}
    </Panel>
  );
}
