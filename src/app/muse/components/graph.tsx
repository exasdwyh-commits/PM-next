"use client";

import { useMemo, useState } from "react";
import type {
  KernGraphNode,
  KernGraphTruth,
  KernGraphV1,
} from "@/modules/visual-intelligence/contracts";
import { Tag } from "./kit";

const TRUTH: Record<
  KernGraphTruth,
  { label: string; tone: "ok" | "warn" | "neutral" }
> = {
  VERIFIED: { label: "已确认", tone: "ok" },
  INFERRED: { label: "推断 / 规划", tone: "warn" },
  UNKNOWN: { label: "未知", tone: "neutral" },
};

const VIEW_LABEL: Record<KernGraphV1["view"], string> = {
  SYSTEM: "系统图",
  DEPENDENCY: "依赖图",
  CAUSAL: "因果图",
  DECISION: "决策图",
  EXECUTION: "执行图",
};

function metadataRows(node: KernGraphNode) {
  return Object.entries(node.metadata || {});
}

export function KernGraphCard({ graph }: { graph: KernGraphV1 }) {
  const layers = useMemo(() => {
    const grouped = new Map<number, KernGraphNode[]>();
    for (const node of graph.nodes) {
      const list = grouped.get(node.layer) || [];
      list.push(node);
      grouped.set(node.layer, list);
    }
    return [...grouped.entries()].sort((a, b) => a[0] - b[0]);
  }, [graph]);

  const [selectedId, setSelectedId] = useState(graph.nodes[0]?.id || "");
  const selected =
    graph.nodes.find((node) => node.id === selectedId) || graph.nodes[0] || null;
  const related = selected
    ? graph.edges.filter(
        (edge) => edge.from === selected.id || edge.to === selected.id
      )
    : [];

  return (
    <section className="m-graph-card" aria-label={graph.title}>
      <header className="m-graph-head">
        <div>
          <div className="m-graph-kicker">
            <span>Kern Visual Intelligence</span>
            <Tag tone="neutral">{VIEW_LABEL[graph.view]}</Tag>
          </div>
          <h3>{graph.title}</h3>
          <p>{graph.summary}</p>
        </div>
      </header>

      <div className="m-graph-scroll" tabIndex={0} aria-label="可滚动关系图">
        <div className="m-graph-flow">
          {layers.map(([layer, nodes], index) => (
            <div className="m-graph-stage-wrap" key={layer}>
              <div className="m-graph-stage" aria-label={`第 ${layer + 1} 层`}>
                {nodes.map((node) => {
                  const truth = TRUTH[node.truth];
                  return (
                    <button
                      type="button"
                      key={node.id}
                      className="m-graph-node"
                      data-active={selected?.id === node.id ? "true" : undefined}
                      data-truth={node.truth.toLowerCase()}
                      onClick={() => setSelectedId(node.id)}
                    >
                      <span className="m-graph-node-type">{node.type}</span>
                      <b>{node.label}</b>
                      {node.detail ? <small>{node.detail}</small> : null}
                      <span className="m-graph-node-state">
                        <Tag tone={truth.tone}>{truth.label}</Tag>
                      </span>
                    </button>
                  );
                })}
              </div>
              {index < layers.length - 1 ? (
                <span className="m-graph-stage-arrow" aria-hidden>
                  →
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {selected ? (
        <div className="m-graph-passport">
          <div className="m-graph-passport-head">
            <div>
              <span>Semantic Passport</span>
              <h4>{selected.label}</h4>
            </div>
            <Tag tone={TRUTH[selected.truth].tone}>
              {TRUTH[selected.truth].label}
            </Tag>
          </div>
          {selected.detail ? <p>{selected.detail}</p> : null}
          {metadataRows(selected).length > 0 ? (
            <dl>
              {metadataRows(selected).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {related.length > 0 ? (
            <div className="m-graph-relations">
              {related.map((edge) => {
                const peerId = edge.from === selected.id ? edge.to : edge.from;
                const peer = graph.nodes.find((node) => node.id === peerId);
                return (
                  <span key={edge.id}>
                    {edge.from === selected.id ? "→" : "←"} {edge.label || edge.relation}
                    {peer ? ` · ${peer.label}` : ""}
                  </span>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {graph.notices.length > 0 ? (
        <div className="m-graph-notices">
          {graph.notices.map((notice) => (
            <p key={notice}>{notice}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
