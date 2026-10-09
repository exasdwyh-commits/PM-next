"use client";

import * as React from "react";
import { categoryMeta } from "@/modules/tenant";
import "./custom-chart.css";

export function CustomDonut({ value, total = 100, category = "health_food", size = 100, label }: any) {
  const catInfo = categoryMeta(category, "health_food", { tint: "deep" });
  const percentage = Math.round((value / total) * 100);
  const circumference = 2 * Math.PI * 15.9;
  const strokeDasharray = `${(percentage / 100) * circumference} ${circumference}`;
  const [animated, setAnimated] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 100);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="custom-donut" style={{ width: size, height: size } as any}>
      <svg viewBox="0 0 42 42" width={size} height={size} style={{ filter: `drop-shadow(${catInfo.shadow})` }}>
        <defs>
          <linearGradient id={`grad-${category}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={catInfo.color} stopOpacity={1} />
            <stop offset="100%" stopColor={catInfo.color} stopOpacity={0.6} />
          </linearGradient>
        </defs>
        <circle cx="21" cy="21" r="15.9" fill="transparent" stroke="#f0f2f6" strokeWidth="3" />
        <circle
          cx="21" cy="21" r="15.9" fill="transparent"
          stroke={`url(#grad-${category})`} strokeWidth="3.5"
          strokeDasharray={animated ? strokeDasharray : `0 ${circumference}`}
          strokeDashoffset="25" strokeLinecap="round"
          style={{ transition: "stroke-dasharray 1s cubic-bezier(0.16,1,0.3,1)" }}
        />
        <text x="21" y="20" textAnchor="middle" fontSize="8" fontWeight="800" fill="#0f1116">{percentage}%</text>
        {label && <text x="21" y="25" textAnchor="middle" fontSize="3.5" fontWeight="500" fill="#6b7280">{label}</text>}
      </svg>
    </div>
  );
}

export function CustomBarRace({ data, category = "health_food" }: { data: { label: string; value: number }[]; category?: string }) {
  const catInfo = categoryMeta(category, "health_food", { tint: "deep" });
  const max = Math.max(...data.map(d => d.value));
  const [animated, setAnimated] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 100);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="custom-bar-race">
      {data.map((item, idx) => (
        <div key={idx} className="bar-race-item" style={{ animationDelay: `${idx * 80}ms` }}>
          <div className="bar-label"><span>{item.label}</span><strong>¥{item.value}</strong></div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{
                width: animated ? `${(item.value / max) * 100}%` : "0%",
                background: catInfo.gradient,
                boxShadow: catInfo.shadow,
              } as any}
            >
              <div className="bar-shimmer"></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function CustomWaterfall({ data, category = "health_food" }: { data: { label: string; value: number; type: "cost" | "profit" }[]; category?: string }) {
  const catInfo = categoryMeta(category, "health_food", { tint: "deep" });
  let cumulative = 0;

  return (
    <div className="custom-waterfall">
      {data.map((item, idx) => {
        const prev = cumulative;
        cumulative += item.value;
        const isProfit = item.type === "profit";
        return (
          <div key={idx} className="waterfall-item" style={{ animationDelay: `${idx * 100}ms` }}>
            <div className="waterfall-label"><span>{item.label}</span><small>{isProfit ? "利润" : "成本"}</small></div>
            <div className="waterfall-bar" style={{ height: `${Math.abs(item.value) * 2}px`, background: isProfit ? "linear-gradient(135deg,#0b7a4f,#10b981)" : catInfo.gradient, boxShadow: isProfit ? "0 4px 12px rgba(11,122,79,0.15)" : catInfo.shadow } as any}>
              <span>¥{item.value}</span>
            </div>
            <div className="waterfall-cumulative">累计 ¥{cumulative.toFixed(1)}</div>
          </div>
        );
      })}
    </div>
  );
}

export function CustomRadar({ data, category = "health_food" }: { data: { label: string; value: number }[]; category?: string }) {
  const catInfo = categoryMeta(category, "health_food", { tint: "deep" });
  const size = 120;
  const center = size / 2;
  const radius = 45;
  const angleStep = (2 * Math.PI) / data.length;

  const points = data.map((d, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const r = (d.value / 100) * radius;
    return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
  }).join(" ");

  const gridPoints = [0.25, 0.5, 0.75, 1].map(factor => {
    return data.map((_, i) => {
      const angle = i * angleStep - Math.PI / 2;
      const r = factor * radius;
      return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
    }).join(" ");
  });

  return (
    <div className="custom-radar">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        {gridPoints.map((pts, idx) => (
          <polygon key={idx} points={pts} fill="none" stroke="#f0f2f6" strokeWidth="0.5" opacity={0.5 + idx * 0.15} />
        ))}
        {data.map((_, i) => {
          const angle = i * angleStep - Math.PI / 2;
          return <line key={i} x1={center} y1={center} x2={center + radius * Math.cos(angle)} y2={center + radius * Math.sin(angle)} stroke="#f0f2f6" strokeWidth="0.5" />;
        })}
        <polygon points={points} fill={catInfo.color} fillOpacity={0.2} stroke={catInfo.color} strokeWidth="1.5" strokeLinejoin="round" style={{ filter: `drop-shadow(${catInfo.shadow})` }} />
        {data.map((d, i) => {
          const angle = i * angleStep - Math.PI / 2;
          const r = (d.value / 100) * radius;
          return <circle key={i} cx={center + r * Math.cos(angle)} cy={center + r * Math.sin(angle)} r="2.5" fill={catInfo.color} stroke="white" strokeWidth="1" />;
        })}
      </svg>
      <div className="radar-labels">
        {data.map((d, i) => (
          <span key={i} style={{ color: catInfo.color, fontWeight: 600 }}>{d.label}: {d.value}%</span>
        ))}
      </div>
    </div>
  );
}
