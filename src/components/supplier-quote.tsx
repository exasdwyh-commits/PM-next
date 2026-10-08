"use client";

import * as React from "react";
import { useRole } from "./role-context";
import { compareSupplierQuotes, groupQuotesByProduct, getSupplierTemplate, type SupplierQuote } from "@/modules/cost-engine/supplier-quote";
import "./supplier-quote.css";

export function SupplierQuoteManager({
  category = "health_food",
  onSelect,
}: {
  category?: string;
  onSelect?: (quotes: SupplierQuote[]) => void;
}) {
  const { role } = useRole();
  const [quotes, setQuotes] = React.useState<SupplierQuote[]>(() => getSupplierTemplate(category));
  const [newQuote, setNewQuote] = React.useState<Partial<SupplierQuote>>({ productName: "", supplierName: "", unitPrice: 0, moq: 1000, leadTime: "7天", category: "原料" });

  const grouped = React.useMemo(() => groupQuotesByProduct(quotes), [quotes]);
  const totalSelectedCost = React.useMemo(() => quotes.filter(q => q.isSelected).reduce((sum, q) => sum + q.unitPrice, 0), [quotes]);

  React.useEffect(() => {
    onSelect?.(quotes.filter(q => q.isSelected));
  }, [quotes, onSelect]);

  const toggleSelect = (id: string) => {
    setQuotes(prev => prev.map(q => q.id === id ? { ...q, isSelected: !q.isSelected } : q));
  };

  const addQuote = () => {
    if (!newQuote.productName || !newQuote.supplierName || !newQuote.unitPrice) return;
    setQuotes(prev => [...prev, {
      id: `quote-${Date.now()}`,
      supplierName: newQuote.supplierName!,
      productName: newQuote.productName!,
      unitPrice: Number(newQuote.unitPrice) || 0,
      moq: Number(newQuote.moq) || 1000,
      leadTime: newQuote.leadTime || "7天",
      validity: "30天",
      category: newQuote.category || "原料",
      createdAt: new Date().toISOString().slice(0, 10),
    }]);
    setNewQuote({ productName: "", supplierName: "", unitPrice: 0, moq: 1000, leadTime: "7天", category: "原料" });
  };

  const removeQuote = (id: string) => {
    setQuotes(prev => prev.filter(q => q.id !== id));
  };

  if (role === "leadership") {
    return (
      <div className="supplier-quote leadership">
        <h4>🏭 供应商报价 · 已选 {quotes.filter(q => q.isSelected).length} 家 · 总成本 ¥{totalSelectedCost.toFixed(2)}</h4>
        <div className="quote-kpi">
          {Object.entries(grouped).slice(0, 2).map(([product, comp]) => (
            <div key={product} className="kpi-card"><strong>{product}</strong><small>最低 ¥{comp.lowestPrice.toFixed(2)} · 推荐 {comp.recommended?.supplierName}</small></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="supplier-quote" data-role={role}>
      <div className="quote-header">
        <div>
          <h4>🏭 供应商报价管理 · 模块化</h4>
          <small>已选 {quotes.filter(q => q.isSelected).length} 家 · 总成本 ¥{totalSelectedCost.toFixed(2)} · 比价节省 ¥{Object.values(grouped).reduce((sum, comp) => sum + (comp.savings || 0), 0).toFixed(2)}</small>
        </div>
        <select value={category} onChange={e => setQuotes(getSupplierTemplate(e.target.value))}>
          <option value="regular_food">🍪 普通食品供应商</option>
          <option value="health_food">💊 保健食品供应商</option>
          <option value="cross_border_food">🌍 跨境食品供应商</option>
          <option value="cosmetics">💄 化妆品供应商</option>
        </select>
      </div>

      <div className="quote-add">
        <input placeholder="产品名" value={newQuote.productName} onChange={e => setNewQuote({ ...newQuote, productName: e.target.value })} />
        <input placeholder="供应商" value={newQuote.supplierName} onChange={e => setNewQuote({ ...newQuote, supplierName: e.target.value })} />
        <input type="number" step="0.01" placeholder="单价" value={newQuote.unitPrice || ""} onChange={e => setNewQuote({ ...newQuote, unitPrice: Number(e.target.value) })} />
        <input type="number" placeholder="MOQ" value={newQuote.moq || ""} onChange={e => setNewQuote({ ...newQuote, moq: Number(e.target.value) })} />
        <input placeholder="交期" value={newQuote.leadTime} onChange={e => setNewQuote({ ...newQuote, leadTime: e.target.value })} />
        <button onClick={addQuote}>➕ 添加报价</button>
      </div>

      <div className="quote-grouped">
        {Object.entries(grouped).map(([productName, comparison]) => (
          <div key={productName} className="product-group">
            <div className="group-h">
              <strong>{productName}</strong>
              <small>最低 ¥{comparison.lowestPrice.toFixed(2)} · 最高 ¥{comparison.highestPrice.toFixed(2)} · 均价 ¥{comparison.avgPrice.toFixed(2)} · 节省 ¥{comparison.savings?.toFixed(2)}</small>
              {comparison.recommended && <span className="recommended">推荐：{comparison.recommended.supplierName} ¥{comparison.recommended.unitPrice.toFixed(2)}</span>}
            </div>
            <div className="quotes-grid">
              {comparison.quotes.map(quote => (
                <div key={quote.id} className={`quote-card ${quote.isSelected ? "selected" : ""} ${quote.id === comparison.recommended?.id ? "recommended" : ""}`}>
                  <div className="quote-h"><strong>{quote.supplierName}</strong><label><input type="checkbox" checked={!!quote.isSelected} onChange={() => toggleSelect(quote.id)} />选用</label></div>
                  <div className="quote-details">
                    <span>单价：¥{quote.unitPrice.toFixed(2)}</span>
                    <span>MOQ：{quote.moq}</span>
                    <span>交期：{quote.leadTime}</span>
                    <span>类别：{quote.category}</span>
                    {quote.isImported && <span className="imported">进口</span>}
                  </div>
                  {quote.notes && <small className="notes">{quote.notes}</small>}
                  <button className="remove" onClick={() => removeQuote(quote.id)}>删除</button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {role === "sales" && (
        <div className="quote-sales">
          <strong>💼 销售视角：供应商优势</strong>
          <p>已选 {quotes.filter(q => q.isSelected).length} 家优质供应商，总成本 ¥{totalSelectedCost.toFixed(2)}，通过比价节省 ¥{Object.values(grouped).reduce((sum, comp) => sum + (comp.savings || 0), 0).toFixed(2)}，供应链稳定，可用于客户话术。</p>
        </div>
      )}
    </div>
  );
}
