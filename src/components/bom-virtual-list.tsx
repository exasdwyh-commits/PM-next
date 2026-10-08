"use client";

import * as React from "react";
import type { BomItem } from "@/modules/cost-engine/bom-import";
import "./bom-virtual-list.css";

export function BomVirtualList({
  items,
  onUpdate,
  onRemove,
  height = 400,
  rowHeight = 48,
}: {
  items: BomItem[];
  onUpdate: (id: string, field: keyof BomItem, value: any) => void;
  onRemove: (id: string) => void;
  height?: number;
  rowHeight?: number;
}) {
  const [scrollTop, setScrollTop] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const visibleCount = Math.ceil(height / rowHeight) + 2;
  const startIndex = Math.floor(scrollTop / rowHeight);
  const endIndex = Math.min(startIndex + visibleCount, items.length);
  const visibleItems = items.slice(startIndex, endIndex);
  const totalHeight = items.length * rowHeight;
  const offsetY = startIndex * rowHeight;

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  if (items.length === 0) {
    return <div className="bom-virtual-list empty">暂无原料，添加或导入BOM</div>;
  }

  return (
    <div className="bom-virtual-list">
      <div className="virtual-header">
        <small>虚拟滚动 · {items.length}种原料 · 可支持1000+不卡顿 · 显示 {startIndex + 1}-{endIndex}</small>
        <small>滚动位置：{scrollTop}px · 可视{visibleCount}行</small>
      </div>

      <div className="virtual-table-header">
        <span style={{ flex: 2 }}>原料</span>
        <span style={{ flex: 1 }}>用量</span>
        <span style={{ flex: 1 }}>单价</span>
        <span style={{ flex: 1 }}>成本</span>
        <span style={{ flex: 1 }}>供应商</span>
        <span style={{ width: 60 }}>操作</span>
      </div>

      <div ref={containerRef} className="virtual-container" style={{ height }} onScroll={handleScroll}>
        <div style={{ height: totalHeight, position: "relative" }}>
          <div style={{ transform: `translateY(${offsetY}px)`, position: "absolute", top: 0, left: 0, right: 0 }}>
            {visibleItems.map(item => (
              <div key={item.id} className="virtual-row" style={{ height: rowHeight }}>
                <input value={item.name} onChange={e => onUpdate(item.id, "name", e.target.value)} style={{ flex: 2 }} />
                <input type="number" value={item.quantity} onChange={e => onUpdate(item.id, "quantity", Number(e.target.value))} style={{ flex: 1 }} />
                <input type="number" value={item.unitPrice} onChange={e => onUpdate(item.id, "unitPrice", Number(e.target.value))} style={{ flex: 1 }} />
                <strong style={{ flex: 1, textAlign: "right" }}>¥{(item.quantity * item.unitPrice).toFixed(2)}</strong>
                <input value={item.supplier || ""} onChange={e => onUpdate(item.id, "supplier", e.target.value)} placeholder="供应商" style={{ flex: 1 }} />
                <button onClick={() => onRemove(item.id)} style={{ width: 60 }}>删除</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="virtual-footer">
        <small>💡 虚拟滚动优化：仅渲染可视{visibleCount}行，1000+原料不卡顿，滚动位置{scrollTop}px，总高度{totalHeight}px</small>
      </div>
    </div>
  );
}
