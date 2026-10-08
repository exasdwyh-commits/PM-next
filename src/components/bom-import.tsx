"use client";

import * as React from "react";
import { useRole } from "./role-context";
import { calculateBomCost, parseBomCsv, getBomTemplate, type BomItem } from "@/modules/cost-engine/bom-import";
import "./bom-import.css";

function parseExcelText(text: string): BomItem[] {
  // Simple Excel CSV-like parsing, supports tab-separated and comma-separated
  const lines = text.trim().split("\n");
  const items: BomItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Skip header if contains non-numeric
    if (i === 0 && /名称|原料|用量|单价/.test(line)) continue;
    const cols = line.split(/[\t,]/).map(c => c.trim().replace(/^"|"$/g, ""));
    if (cols.length < 3) continue;
    const [name, quantityStr, unitPriceStr, unit, supplier, spec] = cols;
    const quantity = Number(quantityStr) || 0;
    const unitPrice = Number(unitPriceStr) || 0;
    if (!name || quantity === 0) continue;
    items.push({
      id: `bom-excel-${i}-${Date.now()}`,
      name: name || `原料${i}`,
      spec,
      supplier,
      quantity,
      unit: unit || "g",
      unitPrice,
      cost: quantity * unitPrice,
    });
  }
  return items;
}


export function BomImport({
  category = "health_food",
  onCostChange,
}: {
  category?: string;
  onCostChange?: (totalCost: number, items: BomItem[]) => void;
}) {
  const { role } = useRole();
  const [items, setItems] = React.useState<BomItem[]>(() => getBomTemplate(category));
  const [csvInput, setCsvInput] = React.useState("");
  const [showCsv, setShowCsv] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [excelPreview, setExcelPreview] = React.useState<BomItem[]>([]);

  const result = React.useMemo(() => calculateBomCost(items), [items]);

  React.useEffect(() => {
    onCostChange?.(result.totalCost, result.items);
  }, [result.totalCost, result.items, onCostChange]);

  const updateItem = (id: string, field: keyof BomItem, value: any) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const addItem = () => {
    setItems(prev => [...prev, {
      id: `bom-${Date.now()}`,
      name: "新原料",
      quantity: 1,
      unit: "g",
      unitPrice: 0,
      cost: 0,
    }]);
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseExcelText(text);
      if (parsed.length > 0) {
        setExcelPreview(parsed);
      }
    };
    // For demo, read as text (real xlsx would need xlsx lib, here we support CSV/TSV exported from Excel)
    reader.readAsText(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseExcelText(text);
      if (parsed.length > 0) setExcelPreview(parsed);
    };
    reader.readAsText(file);
  };

  const confirmExcelImport = () => {
    if (excelPreview.length > 0) {
      setItems(excelPreview);
      setExcelPreview([]);
    }
  };

  const handleCsvImport = () => {
    const parsed = parseBomCsv(csvInput);
    if (parsed.length > 0) {
      setItems(parsed);
      setShowCsv(false);
      setCsvInput("");
    }
  };

  const loadTemplate = (cat: string) => {
    setItems(getBomTemplate(cat));
  };

  if (role === "leadership") {
    return (
      <div className="bom-import leadership">
        <h4>🌱 原料清单 · {result.ingredientCount}种 · 总成本 ¥{result.totalCost.toFixed(2)}</h4>
        <div className="bom-kpi">
          <span>总成本 ¥{result.totalCost.toFixed(2)}</span>
          <span>{result.ingredientCount}种原料</span>
          {result.totalImportedCost > 0 && <span>进口 ¥{result.totalImportedCost.toFixed(2)}</span>}
        </div>
        <div className="bom-cards">
          {result.items.slice(0, 3).map(item => (
            <div key={item.id} className="bom-card"><strong>{item.name}</strong><span>¥{item.cost.toFixed(2)}</span></div>
          ))}
        </div>
        {result.warnings.length > 0 && <small className="warnings">⚠️ {result.warnings[0]}</small>}
      </div>
    );
  }

  return (
    <div className="bom-import" data-role={role}>
      <div className="bom-header">
        <div>
          <h4>🌱 BOM原料清单 · 模块化</h4>
          <small>总成本 ¥{result.totalCost.toFixed(2)} · {result.ingredientCount}种 · 进口 ¥{result.totalImportedCost.toFixed(2)} · 国产 ¥{result.totalDomesticCost.toFixed(2)}</small>
        </div>
        <div className="bom-actions">
          <select value={category} onChange={e => loadTemplate(e.target.value)}>
            <option value="regular_food">🍪 普通食品模板</option>
            <option value="health_food">💊 保健食品模板</option>
            <option value="cross_border_food">🌍 跨境食品模板</option>
            <option value="cosmetics">💄 化妆品模板</option>
          </select>
          <button onClick={() => setShowCsv(!showCsv)}>📤 导入CSV</button>
          <button onClick={addItem}>➕ 添加原料</button>
        </div>
      </div>

      {excelPreview.length > 0 && (
        <div className="excel-preview">
          <h5>📊 Excel预览 · {excelPreview.length}种 · 总成本 ¥{excelPreview.reduce((s,i)=>s+i.cost,0).toFixed(2)}</h5>
          <div className="preview-table-wrap">
            <table className="bom-table">
              <thead><tr><th>原料</th><th>用量</th><th>单价</th><th>成本</th><th>供应商</th></tr></thead>
              <tbody>
                {excelPreview.slice(0,5).map(item => (
                  <tr key={item.id}><td>{item.name}</td><td>{item.quantity}{item.unit}</td><td>¥{item.unitPrice}</td><td>¥{item.cost.toFixed(2)}</td><td>{item.supplier||"-"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="primary" onClick={confirmExcelImport}>✅ 确认导入</button>
            <button onClick={() => setExcelPreview([])}>取消</button>
          </div>
          <small>支持Excel导出的CSV/TSV，列：名称,数量,单价,单位,供应商,规格</small>
        </div>
      )}

      <div className={`excel-drop ${dragOver ? "drag-over" : ""}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" onChange={handleExcelUpload} style={{ display: "none" }} id="excel-upload" />
        <label htmlFor="excel-upload" style={{ cursor: "pointer", display: "grid", gap: 4, placeItems: "center" }}>
          <span style={{ fontSize: 20 }}>📊</span>
          <strong style={{ fontSize: 12 }}>拖拽Excel/CSV到此处或点击上传</strong>
          <small style={{ fontSize: 10, color: "#6b7280" }}>支持CSV/TSV，Excel导出为CSV后拖拽，自动解析BOM</small>
        </label>
      </div>

      {showCsv && (
        <div className="csv-import">
          <textarea value={csvInput} onChange={e => setCsvInput(e.target.value)} placeholder="粘贴CSV：名称,数量,单价,单位,供应商,规格&#10;例如：多酚提取物,0.5,8,g,供应商A,80度烘焙" rows={4} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleCsvImport}>导入</button>
            <button onClick={() => setShowCsv(false)}>取消</button>
          </div>
          <small>格式：名称,数量,单价,单位,供应商,规格 (第一行表头会被跳过)</small>
        </div>
      )}

      <div className="bom-table-wrap">
        <table className="bom-table">
          <thead><tr><th>原料</th><th>用量</th><th>单位</th><th>单价</th><th>成本</th><th>供应商</th><th>操作</th></tr></thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id}>
                <td><input value={item.name} onChange={e => updateItem(item.id, "name", e.target.value)} /></td>
                <td><input type="number" step="0.01" value={item.quantity} onChange={e => updateItem(item.id, "quantity", Number(e.target.value))} /></td>
                <td><input value={item.unit} onChange={e => updateItem(item.id, "unit", e.target.value)} /></td>
                <td><input type="number" step="0.01" value={item.unitPrice} onChange={e => updateItem(item.id, "unitPrice", Number(e.target.value))} /></td>
                <td><strong>¥{(item.quantity * item.unitPrice).toFixed(2)}</strong></td>
                <td><input value={item.supplier || ""} onChange={e => updateItem(item.id, "supplier", e.target.value)} placeholder="供应商" /></td>
                <td><button onClick={() => removeItem(item.id)}>删除</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={4}><strong>合计 {result.ingredientCount}种</strong></td><td><strong>¥{result.totalCost.toFixed(2)}</strong></td><td colSpan={2}></td></tr></tfoot>
        </table>
      </div>

      {result.warnings.length > 0 && (
        <div className="warnings">
          {result.warnings.map((w,i) => <small key={i}>⚠️ {w}</small>)}
        </div>
      )}

      {role === "sales" && (
        <div className="bom-sales">
          <strong>💼 销售视角：原料卖点</strong>
          <p>核心原料成本 ¥{result.totalCost.toFixed(2)}，{result.items[0]?.name}等{result.ingredientCount}种，{result.totalImportedCost > 0 ? `含进口原料，品质保障` : `国产优质原料`}，可直接用于话术。</p>
        </div>
      )}
    </div>
  );
}
