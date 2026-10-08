"use client";

import * as React from "react";
import type { SupplierQuote } from "@/modules/cost-engine/supplier-quote";
import "./supplier-qualification.css";

export interface SupplierQualification {
  id: string;
  supplierId: string;
  supplierName: string;
  type: "business_license" | "certification" | "test_report" | "audit_report" | "other";
  fileName: string;
  fileType: string;
  fileSize: number;
  url: string;
  issuedAt: string;
  expiresAt?: string;
  issuer?: string;
  status: "valid" | "expiring" | "expired";
  notes?: string;
}

export function SupplierQualificationManager({
  supplier,
  qualifications = [],
  onUpload,
  onDelete,
}: {
  supplier: SupplierQuote;
  qualifications?: SupplierQualification[];
  onUpload?: (qual: SupplierQualification) => void;
  onDelete?: (id: string) => void;
}) {
  const [dragOver, setDragOver] = React.useState(false);

  const getStatus = (expiresAt?: string): "valid" | "expiring" | "expired" => {
    if (!expiresAt) return "valid";
    const now = new Date();
    const exp = new Date(expiresAt);
    const diffDays = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return "expired";
    if (diffDays < 30) return "expiring";
    return "valid";
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      const qual: SupplierQualification = {
        id: `qual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        supplierId: supplier.id,
        supplierName: supplier.supplierName,
        type: "other",
        fileName: file.name,
        fileType: file.type || file.name.split(".").pop() || "unknown",
        fileSize: file.size,
        url: URL.createObjectURL(file),
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        issuer: "发证机构",
        status: "valid",
        notes: `${supplier.supplierName} - ${file.name}`,
      };
      qual.status = getStatus(qual.expiresAt);
      onUpload?.(qual);
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => {
      const qual: SupplierQualification = {
        id: `qual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        supplierId: supplier.id,
        supplierName: supplier.supplierName,
        type: "other",
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        url: URL.createObjectURL(file),
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        status: "valid",
      };
      qual.status = getStatus(qual.expiresAt);
      onUpload?.(qual);
    });
  };

  const typeLabel: Record<string, string> = {
    business_license: "营业执照",
    certification: "认证证书",
    test_report: "检测报告",
    audit_report: "审计报告",
    other: "其他",
  };

  const statusLabel: Record<string, { label: string; color: string }> = {
    valid: { label: "有效", color: "#0b7a4f" },
    expiring: { label: "即将过期", color: "#d97706" },
    expired: { label: "已过期", color: "#b32b23" },
  };

  return (
    <div className="supplier-qualification">
      <div className="qual-header">
        <strong>🏅 {supplier.supplierName} · 资质</strong>
        <small>{qualifications.length}个 · {qualifications.filter(q => q.status === "valid").length}有效 · {qualifications.filter(q => q.status === "expiring").length}即将过期 · {qualifications.filter(q => q.status === "expired").length}过期</small>
      </div>

      <div className={`qual-drop ${dragOver ? "drag-over" : ""}`} onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop}>
        <input type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={handleFileUpload} style={{ display: "none" }} id={`qual-upload-${supplier.id}`} />
        <label htmlFor={`qual-upload-${supplier.id}`} style={{ cursor: "pointer", display: "grid", gap: 4, placeItems: "center" }}>
          <span style={{ fontSize: 20 }}>🏅</span>
          <strong style={{ fontSize: 11 }}>拖拽资质文件到此处或点击上传</strong>
          <small style={{ fontSize: 9, color: "#6b7280" }}>营业执照/认证/检测报告，自动检查过期</small>
        </label>
      </div>

      <div className="qual-list">
        {qualifications.map(qual => {
          const status = statusLabel[qual.status];
          return (
            <div key={qual.id} className={`qual-item ${qual.status}`}>
              <div className="qual-icon">🏅</div>
              <div className="qual-info">
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <strong>{qual.fileName}</strong>
                  <span className="type">{typeLabel[qual.type]}</span>
                  <span className="status" style={{ background: `${status.color}15`, color: status.color, border: `1px solid ${status.color}30` }}>{status.label}</span>
                </div>
                <small>{(qual.fileSize / 1024).toFixed(1)}KB · 发证 {new Date(qual.issuedAt).toLocaleDateString()} · 过期 {qual.expiresAt ? new Date(qual.expiresAt).toLocaleDateString() : "长期"} · {qual.issuer || "-"}</small>
                {qual.notes && <small className="notes">{qual.notes}</small>}
              </div>
              <div className="qual-actions">
                <button onClick={() => window.open(qual.url, "_blank")}>👁️ 查看</button>
                <button className="danger" onClick={() => onDelete?.(qual.id)}>🗑️ 删除</button>
              </div>
            </div>
          );
        })}
        {qualifications.length === 0 && <div className="empty">暂无资质，拖拽或上传营业执照/认证/检测报告</div>}
      </div>

      {qualifications.filter(q => q.status !== "valid").length > 0 && (
        <div className="qual-warning">
          <small>⚠️ 有 {qualifications.filter(q => q.status === "expiring").length}个资质即将过期，{qualifications.filter(q => q.status === "expired").length}个已过期，请及时更新</small>
        </div>
      )}
    </div>
  );
}
