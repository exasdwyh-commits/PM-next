"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { agentLabel, nodeLabel, reasonLabel, type MissionEvent, type MissionStatusView } from "../mission-timeline";
import { FLOW_GOAL, FLOW_NODE, flowExcerpt, flowIsRunning, flowNodeDetails, flowNodeState, flowNodeSummary, flowNodeTitle, flowSourceUrl, layoutExecutionFlow, revealedFlowKeys } from "../execution-flow";
import { I } from "./kit";
import { Prose } from "./prose";
import "./execution-flow.css";

type View = { scale: number; x: number; y: number };

/** A read-only view of the real plan. Animations never advance execution state. */
export function ExecutionFlow({ status, events = [], connected = true, activity }: { status: MissionStatusView; events?: MissionEvent[]; connected?: boolean; activity?: string }) {
  const id = useId();
  const layout = useMemo(() => layoutExecutionFlow(status.nodes), [status.nodes]);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; view: View } | null>(null);
  const [size, setSize] = useState({ width: 640, height: 366 });
  const [view, setView] = useState<View | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [visible, setVisible] = useState(true);
  const [showPlan, setShowPlan] = useState(false);
  const revealed = revealedFlowKeys(status, showPlan);
  const nodes = status.nodes.filter(node => revealed.has(node.key));
  const details = useMemo(() => flowNodeDetails(status, events), [status, events]);
  const positions = layout.positions.map(position => ({ ...position, x: position.x + FLOW_GOAL.offset }));
  const worldWidth = layout.width + FLOW_GOAL.offset;
  const shownWidth = Math.max(FLOW_GOAL.width + FLOW_NODE.padding * 2, ...positions.filter(position => revealed.has(position.key)).map(position => position.x + FLOW_NODE.width + FLOW_NODE.padding));
  const goalY = (layout.height - FLOW_GOAL.height) / 2;
  const selected = status.nodes.find(node => node.key === selectedKey);
  const fitScale = Math.min(1, Math.max(size.width < 480 ? .86 : .72, Math.min(size.width / shownWidth, size.height / layout.height)));
  const fitted = { scale: fitScale, x: (size.width - shownWidth * fitScale) / 2, y: (size.height - layout.height * fitScale) / 2 };
  const camera = view ?? fitted;
  const activeNodes = status.nodes.filter(node => flowNodeState(node, status).tone === "active");
  const running = flowIsRunning(status, connected) && visible && activeNodes.length > 0;
  const current = activity ?? (activeNodes.length ? activeNodes.map(flowNodeTitle).join("、") : status.outcome ? "执行已结束" : status.paused ? "已暂停" : "等待下一步执行");
  const hidden = status.nodes.length - nodes.length;
  const overflow = worldWidth * camera.scale > size.width || layout.height * camera.scale > size.height;
  const focusCurrent = () => {
    const key = activeNodes[0]?.key ?? selectedKey ?? nodes.at(-1)?.key;
    const position = positions.find(item => item.key === key);
    if (position) setView({ scale: Math.max(.86, camera.scale), x: size.width / 2 - (position.x + FLOW_NODE.width / 2) * Math.max(.86, camera.scale), y: size.height / 2 - (position.y + FLOW_NODE.height / 2) * Math.max(.86, camera.scale) });
  };

  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [collapsed]);

  const zoom = (factor: number) => {
    const scale = Math.min(1.6, Math.max(.38, camera.scale * factor));
    const ratio = scale / camera.scale;
    setView({ scale, x: size.width / 2 - (size.width / 2 - camera.x) * ratio, y: size.height / 2 - (size.height / 2 - camera.y) * ratio });
  };
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, view: camera };
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const origin = drag.current;
    if (!origin || origin.pointer !== event.pointerId) return;
    setView({ ...origin.view, x: origin.view.x + event.clientX - origin.x, y: origin.view.y + event.clientY - origin.y });
  };

  return (
    <section className="m-flow" data-motion={running && !collapsed ? "running" : "still"} aria-label="执行工作流">
      <header className="m-flow-head">
        <span className="m-flow-heading"><I.plan /><strong>执行流程</strong><small>{status.progress.done}/{status.progress.total} 步已结束</small></span>
        <div className="m-flow-tools">
          {!collapsed ? <>
            <button type="button" aria-label="定位当前步骤" title="定位当前步骤" onClick={focusCurrent} disabled={!nodes.length}><FlowIcon kind="focus" /></button>
            <button type="button" aria-label="缩小工作流" title="缩小" onClick={() => zoom(1 / 1.2)} disabled={camera.scale <= .38}><FlowIcon kind="minus" /></button>
            <span className="m-flow-scale">{Math.round(camera.scale * 100)}%</span>
            <button type="button" aria-label="放大工作流" title="放大" onClick={() => zoom(1.2)} disabled={camera.scale >= 1.6}><FlowIcon kind="plus" /></button>
            <button type="button" aria-label="适应画布" title="适应画布" onClick={() => setView(null)}><FlowIcon kind="fit" /></button>
          </> : null}
          <button type="button" aria-label={collapsed ? "展开工作流" : "收起工作流"} title={collapsed ? "展开" : "收起"} aria-expanded={!collapsed} aria-controls={id} onClick={() => setCollapsed(value => !value)}><FlowIcon kind={collapsed ? "expand" : "collapse"} /></button>
        </div>
      </header>
      {!collapsed ? <div id={id}>
        <div className="m-flow-context"><span>{status.status === "DRAFT" ? "拟定计划" : activeNodes.length > 1 ? `${activeNodes.length} 项正在并行` : status.outcome ? "执行路径已留存" : "随执行展开"}</span>{!status.outcome && status.status !== "DRAFT" ? <button type="button" aria-pressed={showPlan} onClick={() => { setShowPlan(value => !value); setView(null); }}>{showPlan ? "只看当前路径" : hidden ? `查看全部步骤 · 还有 ${hidden} 项` : "查看全部步骤"}</button> : <small>点击节点查看结果</small>}</div>
        <div className="m-flow-viewport" ref={viewport} tabIndex={0} role="region" aria-label="工作流画布，用方向键移动" onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          const directions: Record<string, [number, number]> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
          const offset = directions[event.key];
          if (!offset) return;
          event.preventDefault();
          setView({ ...camera, x: camera.x + offset[0], y: camera.y + offset[1] });
        }} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
          <div className="m-flow-world" style={{ width: worldWidth, height: layout.height, transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}>
            <svg className="m-flow-wires" width={worldWidth} height={layout.height} aria-hidden="true">
              {nodes.filter(node => !(node.dependsOn?.length)).map(node => {
                const position = positions.find(item => item.key === node.key)!;
                return <path key={`goal:${node.key}`} className="m-flow-origin-wire" pathLength="1" d={wirePath(FLOW_NODE.padding + FLOW_GOAL.width, layout.height / 2, position.x, position.y + FLOW_NODE.height / 2)} />;
              })}
              {layout.edges.filter(edge => revealed.has(edge.from) && revealed.has(edge.to)).map(edge => {
                const from = positions.find(position => position.key === edge.from)!;
                const to = positions.find(position => position.key === edge.to)!;
                const source = status.nodes.find(node => node.key === edge.from)!;
                const target = status.nodes.find(node => node.key === edge.to)!;
                const x1 = from.x + FLOW_NODE.width, y1 = from.y + FLOW_NODE.height / 2;
                const x2 = to.x, y2 = to.y + FLOW_NODE.height / 2;
                const path = wirePath(x1, y1, x2, y2);
                const flowing = source.status === "SUCCEEDED" && flowNodeState(target, status).tone === "active";
                const completed = source.status === "SUCCEEDED" && target.status === "SUCCEEDED";
                return <g key={`${edge.from}:${edge.to}`} data-flowing={flowing || undefined} data-done={completed || undefined} data-selected={selectedKey === edge.from || selectedKey === edge.to || undefined}>
                  <path className="m-flow-wire" pathLength="1" d={path} />
                  {flowing ? <path className="m-flow-current" d={path} /> : null}
                </g>;
              })}
            </svg>
            <div className="m-flow-goal" style={{ left: FLOW_NODE.padding, top: goalY, width: FLOW_GOAL.width, height: FLOW_GOAL.height }} title={status.goal}><span><I.spark />工作目标</span><strong>{flowExcerpt(status.goal, 88)}</strong></div>
            {nodes.map(node => {
              const position = positions.find(item => item.key === node.key)!;
              const state = flowNodeState(node, status);
              const detail = details.get(node.key)!;
              const summary = flowNodeSummary(node);
              const preview = state.tone === "done" ? flowExcerpt(summary, 86) || "步骤已完成，点击查看详情" : state.tone === "active" ? connected ? detail.activity || "正在执行这项任务" : "连接中断 · 保留最近进展" : node.reason ? reasonLabel(node.reason) : state.tone === "idle" ? node.status === "PENDING" ? "计划中的步骤，尚未执行" : state.label : state.label;
              return <button key={node.key} type="button" className="m-flow-node" data-flow-state={state.tone} data-planned={node.status === "PENDING" || undefined} data-selected={selectedKey === node.key || undefined} aria-pressed={selectedKey === node.key} aria-label={`${flowNodeTitle(node)}，${state.label}，${agentLabel(node.agentCode)}`} title={node.objective || nodeLabel(node.key)} onClick={() => setSelectedKey(key => key === node.key ? null : node.key)} style={{ left: position.x, top: position.y, width: FLOW_NODE.width, height: FLOW_NODE.height } as CSSProperties}>
                <i className="m-flow-port is-input" aria-hidden="true" />
                <span className="m-flow-node-top"><span className="m-flow-symbol" key={state.tone} aria-hidden="true">{state.tone === "done" ? <I.check /> : state.tone === "blocked" || state.tone === "failed" ? <FlowIcon kind="alert" /> : node.kind === "SYNTHESIS" ? <I.spark /> : node.kind === "QA" || node.kind === "RED_TEAM" ? <I.shield /> : <I.source />}</span><span className="m-flow-node-copy"><small>{agentLabel(node.agentCode)}{node.kind === "SYNTHESIS" ? " · 综合" : node.kind === "QA" ? " · 复核" : ""}</small><strong>{flowNodeTitle(node)}</strong></span></span>
                <span className="m-flow-node-preview" key={node.status}>{preview}</span>
                {detail.uncertainty || detail.retracted ? <span className="m-flow-evidence-note">{detail.retracted ? "已有结论被推翻" : "有待核实的信息"}</span> : null}
                <span className="m-flow-node-state"><i aria-hidden="true" />{state.label}{node.attempts > 1 ? <em>第 {node.attempts} 次</em> : null}</span>
                {detail.sources.length ? <span className="m-flow-source-count"><I.source />{detail.sources.length} 个引用</span> : null}
                <i className="m-flow-port is-output" aria-hidden="true" />
              </button>;
            })}
          </div>
          {overflow && status.nodes.length ? <button className="m-flow-minimap" type="button" aria-label="工作流全景，点击定位画布" title="点击全景定位" onClick={event => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = (event.clientX - bounds.left) / bounds.width * worldWidth;
            const y = (event.clientY - bounds.top) / bounds.height * layout.height;
            setView({ ...camera, x: size.width / 2 - x * camera.scale, y: size.height / 2 - y * camera.scale });
            if (event.detail === 0) setView(null);
          }}><svg viewBox={`0 0 ${worldWidth} ${layout.height}`} preserveAspectRatio="none" aria-hidden="true"><rect className="m-flow-map-goal" x={FLOW_NODE.padding} y={goalY} width={FLOW_GOAL.width} height={FLOW_GOAL.height} rx="10" />{positions.map(position => <rect key={position.key} data-flow-state={flowNodeState(status.nodes.find(node => node.key === position.key)!, status).tone} opacity={revealed.has(position.key) ? 1 : .25} x={position.x} y={position.y} width={FLOW_NODE.width} height={FLOW_NODE.height} rx="10" />)}<rect className="m-flow-map-window" x={Math.max(0, -camera.x / camera.scale)} y={Math.max(0, -camera.y / camera.scale)} width={Math.min(worldWidth, size.width / camera.scale)} height={Math.min(layout.height, size.height / camera.scale)} /></svg></button> : null}
          {!status.nodes.length ? <p className="m-flow-empty">还没有可展示的执行步骤。</p> : null}
        </div>
        {layout.unresolved.length ? <p className="m-flow-warning">部分步骤的依赖存在循环，无法确定执行顺序。</p> : null}
        {selected ? <div className="m-flow-inspector" key={selected.key}>
          <header><strong>{nodeLabel(selected.key)}</strong><span>{flowNodeState(selected, status).label}</span><button type="button" aria-label="关闭节点详情" onClick={() => setSelectedKey(null)}><I.close /></button></header>
          {selected.objective ? <p>{selected.objective}</p> : null}
          {selected.reason ? <p className="m-flow-warning">{reasonLabel(selected.reason)}</p> : null}
          {details.get(selected.key)?.retracted || details.get(selected.key)?.uncertainty ? <p className="m-flow-warning">{details.get(selected.key)?.retracted ? "这一步曾出现结论被推翻或收回的记录，请结合复核结果查看。" : "这一步标记了尚未核实的信息，摘要不代表证据已经完整。"}</p> : null}
          {selected.summary ? <div className="m-flow-result">{selected.status !== "SUCCEEDED" ? <small>保留的结果摘要 · 当前步骤尚未成功完成</small> : null}<Prose text={flowNodeSummary(selected)} /></div> : <small>{selected.status === "ACTIVE" ? "执行结果会在这一步结束后显示。" : selected.status === "PENDING" ? "这一步还没有开始。" : "暂无结果摘要。"}</small>}
          {details.get(selected.key)?.sources.length ? <div className="m-flow-sources"><strong>本次执行的引用来源</strong><ul>{details.get(selected.key)!.sources.map((source, index) => {
            const url = flowSourceUrl(source.url);
            return <li key={`${source.url}:${index}`}><I.source />{url ? <a href={url} target="_blank" rel="noopener noreferrer">{source.title}</a> : <span>{source.title}</span>}</li>;
          })}</ul></div> : null}
        </div> : null}
      </div> : null}
      <footer className="m-flow-foot" role="status" aria-live="polite"><span className="m-flow-live" aria-hidden="true" /><span>{current}</span>{!connected && !status.outcome ? <small>正在重新连接</small> : activeNodes.length > 1 && running ? <small>{activeNodes.length} 项并行</small> : null}</footer>
    </section>
  );
}

function wirePath(x1: number, y1: number, x2: number, y2: number) {
  const bend = Math.max(26, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

function FlowIcon({ kind }: { kind: "plus" | "minus" | "fit" | "collapse" | "expand" | "alert" | "focus" }) {
  const paths = { plus: "M5 10h10M10 5v10", minus: "M5 10h10", fit: "M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4", focus: "M10 2v3m0 10v3M2 10h3m10 0h3M10 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8", collapse: "m5 12 5-5 5 5", expand: "m5 8 5 5 5-5", alert: "M10 6v5m0 3h.01M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16" };
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}
