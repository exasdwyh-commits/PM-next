/**
 * 富可视化 - 图表组件
 * 瀑布图、环形图、雷达图，内联SVG+CSS动画，无外部依赖
 */

export function generateWaterfallChartHtml(items: { label: string; value: number; color: string }[], total: number, delay: number = 0): string {
  let cumulative = 0;
  const bars = items.map((item, i) => {
    const start = cumulative;
    cumulative += item.value;
    const isTotal = item.label === "总成本" || i === items.length - 1;
    return { ...item, start, end: cumulative, isTotal, index: i };
  });

  const maxVal = Math.max(...bars.map(b => b.end), total);
  const chartHeight = 200;
  const barWidth = 60;
  const gap = 20;
  const totalWidth = bars.length * (barWidth + gap) + 40;

  const barsHtml = bars.map((bar, i) => {
    const x = 20 + i * (barWidth + gap);
    const barHeight = (bar.value / maxVal) * (chartHeight - 40);
    const y = chartHeight - barHeight - 20;
    const startY = chartHeight - (bar.start / maxVal) * (chartHeight - 40) - 20;
    
    return `
      <g style="animation: fadeInUp 0.6s ease-out ${delay + i * 100}ms both;">
        ${!bar.isTotal ? `
          <line x1="${x + barWidth/2}" y1="${startY}" x2="${x + barWidth/2}" y2="${y + barHeight}" 
                stroke="#e7e9ef" stroke-width="1" stroke-dasharray="3,3"
                style="animation: drawLine 0.6s ease-out ${delay + i * 100 + 300}ms both;"/>
        ` : ''}
        <rect x="${x}" y="${chartHeight - 20}" width="${barWidth}" height="0" 
              fill="${bar.color}" rx="6"
              style="animation: growBar 0.8s ease-out ${delay + i * 100}ms forwards;">
          <animate attributeName="height" from="0" to="${barHeight}" dur="0.8s" begin="${(delay + i * 100)/1000}s" fill="freeze"/>
          <animate attributeName="y" from="${chartHeight - 20}" to="${y}" dur="0.8s" begin="${(delay + i * 100)/1000}s" fill="freeze"/>
        </rect>
        <text x="${x + barWidth/2}" y="${y - 8}" text-anchor="middle" font-size="11" font-weight="600" fill="#0f1116"
              style="animation: fadeIn 0.4s ease-out ${delay + i * 100 + 600}ms both;">¥${bar.value.toFixed(1)}</text>
        <text x="${x + barWidth/2}" y="${chartHeight - 5}" text-anchor="middle" font-size="10" fill="#6b7280">${bar.label}</text>
      </g>
    `;
  }).join("");

  return `
    <div style="background: white; border: 1px solid #e7e9ef; border-radius: 16px; padding: 18px; overflow-x: auto;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <strong style="font-size: 13px;">💧 瀑布图 · 成本累积</strong>
        <small style="font-size: 11px; color: #6b7280;">总计 ¥${total.toFixed(2)}</small>
      </div>
      <svg width="${totalWidth}" height="${chartHeight + 20}" viewBox="0 0 ${totalWidth} ${chartHeight + 20}" style="overflow: visible;">
        ${barsHtml}
        <line x1="0" y1="${chartHeight - 20}" x2="${totalWidth}" y2="${chartHeight - 20}" stroke="#f0f2f6" stroke-width="1"/>
      </svg>
    </div>
  `;
}

export function generateDonutChartHtml(items: { label: string; value: number; color: string }[], total: number, delay: number = 0): string {
  const centerX = 100;
  const centerY = 100;
  const radius = 70;
  const innerRadius = 45;
  const circumference = 2 * Math.PI * radius;
  
  let cumulative = 0;
  const segments = items.map((item, i) => {
    const percentage = item.value / total;
    const strokeDasharray = `${percentage * circumference} ${circumference}`;
    const rotation = (cumulative / total) * 360;
    cumulative += item.value;
    return { ...item, percentage, strokeDasharray, rotation, index: i };
  });

  const segmentsHtml = segments.map((seg, i) => `
    <circle cx="${centerX}" cy="${centerY}" r="${radius}" 
            fill="none" 
            stroke="${seg.color}" 
            stroke-width="20"
            stroke-dasharray="${seg.strokeDasharray}"
            stroke-dashoffset="0"
            transform="rotate(${seg.rotation - 90} ${centerX} ${centerY})"
            style="
              animation: drawDonut 1s ease-out ${delay + i * 150}ms both;
              transition: all 0.3s ease;
              cursor: pointer;
            "
            onmouseover="this.style.strokeWidth='24'; this.style.filter='brightness(1.1)';"
            onmouseout="this.style.strokeWidth='20'; this.style.filter='none';">
      <title>${seg.label}: ¥${seg.value.toFixed(2)} (${(seg.percentage*100).toFixed(1)}%)</title>
    </circle>
  `).join("");

  const legendHtml = items.map((item, i) => `
    <div style="
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      animation: fadeInUp 0.4s ease-out ${delay + i * 100}ms both;
      cursor: pointer;
      border-radius: 6px;
      transition: background 0.2s;
    " onmouseover="this.style.background='#f6f7f9';" onmouseout="this.style.background='transparent';">
      <div style="width: 12px; height: 12px; background: ${item.color}; border-radius: 3px;"></div>
      <span style="font-size: 12px; flex: 1;">${item.label}</span>
      <span style="font-size: 11px; font-weight: 600;">¥${item.value.toFixed(2)}</span>
      <span style="font-size: 10px; color: #6b7280;">${(item.value/total*100).toFixed(1)}%</span>
    </div>
  `).join("");

  return `
    <div style="background: white; border: 1px solid #e7e9ef; border-radius: 16px; padding: 18px; display: grid; grid-template-columns: 200px 1fr; gap: 20px; align-items: center;">
      <div style="position: relative;">
        <svg width="200" height="200" viewBox="0 0 200 200" style="overflow: visible;">
          ${segmentsHtml}
          <circle cx="${centerX}" cy="${centerY}" r="${innerRadius}" fill="white" stroke="#f0f2f6" stroke-width="1"/>
          <text x="${centerX}" y="${centerY - 5}" text-anchor="middle" font-size="10" fill="#6b7280">总成本</text>
          <text x="${centerX}" y="${centerY + 12}" text-anchor="middle" font-size="16" font-weight="800" fill="#0f1116">¥${total.toFixed(2)}</text>
        </svg>
      </div>
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <strong style="font-size: 13px;">🍩 成本占比 · 环形图</strong>
          <small style="font-size: 11px; color: #6b7280;">${items.length}项</small>
        </div>
        <div style="display: grid; gap: 2px;">${legendHtml}</div>
      </div>
    </div>
  `;
}

export function generateBarRaceHtml(items: { label: string; value: number; color: string }[], max: number, delay: number = 0): string {
  const barsHtml = items.map((item, i) => {
    const pct = (item.value / max * 100).toFixed(0);
    return `
      <div style="
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 0;
        animation: fadeInUp 0.5s ease-out ${delay + i * 80}ms both;
      ">
        <span style="width: 50px; font-size: 12px; font-weight: 500; color: #4b5563; text-align: right;">${item.label}</span>
        <div style="flex: 1; height: 32px; background: #f6f7f9; border-radius: 10px; overflow: hidden; position: relative;">
          <div style="
            width: 0;
            height: 100%;
            background: ${item.color};
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: flex-end;
            padding-right: 10px;
            animation: growWidth 0.8s ease-out ${delay + i * 80 + 200}ms forwards;
            position: relative;
            overflow: hidden;
          ">
            <span style="color: white; font-size: 11px; font-weight: 600; position: relative; z-index: 1;">¥${item.value.toFixed(2)}</span>
            <div style="
              position: absolute;
              top: 0;
              left: -100%;
              width: 100%;
              height: 100%;
              background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
              animation: shimmer 1.5s ease-out ${delay + i * 80 + 800}ms;
            "></div>
          </div>
        </div>
        <span style="width: 45px; font-size: 11px; color: #6b7280; text-align: right;">${pct}%</span>
      </div>
    `;
  }).join("");

  return `
    <div style="background: white; border: 1px solid #e7e9ef; border-radius: 16px; padding: 18px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <strong style="font-size: 13px;">🏁 成本赛跑 · 横向柱状</strong>
        <small style="font-size: 11px; color: #6b7280;">最高 ¥${max.toFixed(2)}</small>
      </div>
      <div style="display: grid; gap: 4px;">${barsHtml}</div>
    </div>
  `;
}

export const CHART_ANIMATIONS_CSS = `
  @keyframes growBar {
    from { height: 0; y: var(--chart-height); }
    to { height: var(--bar-height); y: var(--bar-y); }
  }
  @keyframes drawLine {
    from { stroke-dashoffset: 100; opacity: 0; }
    to { stroke-dashoffset: 0; opacity: 1; }
  }
  @keyframes drawDonut {
    from { stroke-dasharray: 0 1000; opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
`;
