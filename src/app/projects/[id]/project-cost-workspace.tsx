"use client";
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { identityHeaders } from "@/shared/client-identity";
import type CostCalculatorComponent from "@/app/products/[id]/cost-calculator";
import type { ProjectTaskView } from "@/modules/workspace/perspective";
const CostCalculator = dynamic(() => import("@/app/products/[id]/cost-calculator"), {
  loading: () => <p role="status">正在加载成本计算器…</p>,
});
type CalculatorProps = ComponentProps<typeof CostCalculatorComponent>;
type Scenario = NonNullable<CalculatorProps["savedScenarios"]>[number];
type SaveInput = Parameters<NonNullable<CalculatorProps["onSaveScenario"]>>[0];
export default function ProjectCostWorkspace({ productId, tasks, mockAuth, activeUserId }: { productId?: string | null; tasks: ProjectTaskView[]; mockAuth: boolean; activeUserId: string }) {
  const [workItemId, setWorkItemId] = useState("");
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!productId) return;
    const token = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/products/${encodeURIComponent(productId)}/cost-scenarios`, { signal, headers: identityHeaders(mockAuth, activeUserId) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(body?.scenarios)) throw new Error(body?.message || "情景读取失败，请重试。");
      if (!signal?.aborted && request.current === token) setScenarios(body.scenarios);
    } catch (failure) {
      if (!signal?.aborted && request.current === token) setError(failure instanceof Error ? failure.message : "情景读取失败。");
    } finally {
      if (!signal?.aborted && request.current === token) setLoading(false);
    }
  }, [productId, mockAuth, activeUserId]);
  useEffect(() => {
    setScenarios([]);
    const controller = new AbortController();
    void load(controller.signal);
    return () => { controller.abort(); request.current += 1; };
  }, [load]);
  const selectedTask = tasks.find(task => task.id === workItemId);
  const save = async (scenario: SaveInput) => {
    if (!productId || !selectedTask) throw new Error("请先关联产品并选择工作项。");
    const response = await fetch(`/api/products/${encodeURIComponent(productId)}/cost-scenarios`, {
      method: "POST", headers: identityHeaders(mockAuth, activeUserId, { "Content-Type": "application/json" }),
      body: JSON.stringify({ ...scenario, workItemId: selectedTask.id }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.message || "情景保存失败，请重试。");
    await load();
  };
  return <div className="hermes-stack">
    <section className="kern-cost-context">
      <div><h2>项目成本情景</h2>
        <p>用真实报价比较成本与利润。新情景保存到所选工作项，保存时服务器会重新计算。</p>
        {productId ? <Link href={`/products/${encodeURIComponent(productId)}?tab=cost`}>查看产品预算与全部情景 ↗</Link> :
          <p role="status">项目尚未关联产品，可以试算；关联产品后才能保存。</p>}
        <p>此页按 CNY 试算，未加载产品版本预算。{productId ? "已保存情景涵盖该产品的关联项目。" : ""}</p>
      </div>
      {tasks.length > 0 ? <label className="kern-cost-select">保存到工作项
        <select value={selectedTask?.id ?? ""} onChange={event => setWorkItemId(event.target.value)}>
          <option value="" disabled>请选择工作项</option>
          {tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
        </select><small>保存需负责人或决策人权限</small>
      </label> : <p>先到「工作项」创建用于记录成本成果的任务。</p>}
    </section>
    <CostCalculator targetCost={null} currency="CNY" versionTag={null}
      productId={productId ?? undefined} workItemId={selectedTask?.id}
      savedScenarios={scenarios} scenariosLoading={loading} scenariosError={error}
      onRetryScenarios={() => void load()} onSaveScenario={productId && selectedTask ? save : undefined} />
  </div>;
}
