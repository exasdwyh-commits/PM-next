"use client";

import { useMemo, useState } from "react";
import type {
  KernGraphNode,
  KernGraphTruth,
  KernGraphV1,
} from "@/modules/visual-intelligence/contracts";
import { Card, CardHead, Tag } from "./kit";

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
    <Card>
      <CardHead
        title={graph.title}
        aside={<Tag tone="neutral">{VIEW_LABEL[graph.view]}</Tag>}
      />
      <div className="m-card-body">
        <p className="m-quiet" style={{ margin: 0 }}>{graph.summary}</p>

        <div style={{ display: "grid", gap: 14 }}>
          {layers.map(([layer, nodes]) => (
            <section key={layer} style={{ display: "grid", gap: 7 }}>
              <p className="m-hint">第 {layer + 1} 层</p>
              {nodes.map((node) => {
                const truth = TRUTH[node.truth];
                return (
                  <button
                    type="button"
                    key={node.id}
                    className="m-src"
                    aria-pressed={selected?.id === node.id}
                    onClick={() => setSelectedId(node.id)}
                  >
                    <Tag tone={truth.tone}>{truth.label}</Tag>
                    <span>
                      <b>{node.label}</b>
                      {node.detail ? (
                        <small style={{ display: "block", marginTop: 2 }}>
                          {node.detail}
                        </small>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
        </div>

        {selected ? (
          <div className="m-else">
            <div className="m-btn-row" style={{ alignItems: "center" }}>
              <b>{selected.label}</b>
              <Tag tone={TRUTH[selected.truth].tone}>
                {TRUTH[selected.truth].label}
              </Tag>
            </div>
            {selected.detail ? <p style={{ margin: "8px 0 0" }}>{selected.detail}</p> : null}
            {metadataRows(selected).length > 0 ? (
              <dl className="m-kv" style={{ marginTop: 10 }}>
                {metadataRows(selected).map(([key, value]) => (
                  <div key={key} style={{ display: "contents" }}>
                    <dt>{key}</dt>
                    <dd>{String(value)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {related.length > 0 ? (
              <ul className="m-list" style={{ marginTop: 10 }}>
                {related.map((edge) => {
                  const peerId = edge.from === selected.id ? edge.to : edge.from;
                  const peer = graph.nodes.find((node) => node.id === peerId);
                  return (
                    <li key={edge.id}>
                      {edge.from === selected.id ? "→" : "←"} {edge.label || edge.relation}
                      {peer ? ` · ${peer.label}` : ""}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        ) : null}

        {graph.notices.map((notice) => (
          <p className="m-hint" key={notice}>{notice}</p>
        ))}
      </div>
    </Card>
  );
}
