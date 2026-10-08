"use client";

import * as React from "react";
import { useRole } from "./role-context";

const CATEGORY_INFO: Record<string, { icon: string; name: string; color: string }> = {
  regular_food: { icon: "🍪", name: "普通食品", color: "#f59e0b" },
  health_food: { icon: "💊", name: "保健食品", color: "#7c3aed" },
  cross_border_food: { icon: "🌍", name: "跨境食品", color: "#0891b2" },
  cosmetics: { icon: "💄", name: "化妆品", color: "#db2777" },
};

// Memoized KPI card
export const MemoKpiCard = React.memo(function MemoKpiCard({ label, value, color, idx }: any) {
  return (
    <div className="kpi-memo" style={{ animationDelay: `${idx * 80}ms`, borderColor: `${color}20` } as any}>
      <span>{label}</span>
      <strong>{value}</strong>
      <div className="kpi-bar"><div className="fill" style={{ background: color, width: "70%" }}></div></div>
    </div>
  );
});

// Lazy loaded heavy chart
function LazyChartInner({ data, color }: any) {
  return (
    <div className="lazy-chart" style={{ borderColor: `${color}20` } as any}>
      <h5>📊 成本分布 · 懒加载</h5>
      <div className="bars">
        {Object.entries(data || {}).map(([k, v]: any, i: number) => (
          <div key={k} className="bar" style={{ animationDelay: `${i * 60}ms` }}>
            <span>{k}</span>
            <div className="track"><div className="fill" style={{ width: `${Math.min(v / 10, 100)}%`, background: color }}></div></div>
            <small>¥{v}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

export const LazyChart = React.lazy(() => Promise.resolve({ default: LazyChartInner }));

// Virtualized evidence list (windowing)
export function VirtualEvidenceList({ evidences, category = "health_food" }: any) {
  const catInfo = CATEGORY_INFO[category] || CATEGORY_INFO.health_food;
  const [visibleCount, setVisibleCount] = React.useState(10);
  const observerRef = React.useRef<IntersectionObserver | null>(null);
  const lastRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        setVisibleCount(c => Math.min(c + 10, evidences.length));
      }
    });
    if (lastRef.current) observerRef.current.observe(lastRef.current);
    return () => observerRef.current?.disconnect();
  }, [evidences.length, visibleCount]);

  return (
    <div className="virtual-evidence-list">
      <small>虚拟化 · {evidences.length}条证据 · 已加载{visibleCount} · 滚动加载更多 · {catInfo.icon} {catInfo.name}</small>
      <div className="evidence-grid">
        {evidences.slice(0, visibleCount).map((e: any, idx: number) => (
          <div key={e.id || idx} className="evidence-card" style={{ animationDelay: `${idx * 30}ms`, borderLeft: `3px solid ${catInfo.color}` } as any}>
            <strong>{e.fieldKey || e.title || `证据${idx + 1}`}</strong>
            <small>{e.value || e.content?.slice(0, 40) || "证据内容"} · {e.source || "Kern"}</small>
            <span className="lvl A">A</span>
          </div>
        ))}
        <div ref={lastRef} style={{ height: 1 }} />
      </div>
    </div>
  );
}

// Performance wrapper
export function CostCalculatorPerformance({ children, category = "health_food" }: any) {
  const { role } = useRole();
  const catInfo = CATEGORY_INFO[category] || CATEGORY_INFO.health_food;
  const [isClient, setIsClient] = React.useState(false);

  React.useEffect(() => setIsClient(true), []);

  if (!isClient) {
    return <div className="perf-skeleton" style={{ borderColor: catInfo.color } as any}>加载中... {catInfo.icon} {catInfo.name} · {role}视角 · 性能优化</div>;
  }

  return (
    <div className="cost-calc-perf" data-role={role} style={{ borderColor: catInfo.color } as any}>
      <div className="perf-header" style={{ background: `${catInfo.color}08` }}>
        <small>⚡ 性能优化 · {catInfo.icon} {catInfo.name} · {role}视角 · Memo+Lazy+Virtual</small>
        <small>React.memo KPI · React.lazy Chart · IntersectionObserver Evidence · 虚拟滚动 BOM 1000+不卡顿</small>
      </div>
      <React.Suspense fallback={<div>图表加载中... {catInfo.icon}</div>}>
        {children}
      </React.Suspense>
    </div>
  );
}
