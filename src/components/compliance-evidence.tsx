"use client";

import * as React from "react";
import type { ComplianceItem } from "@/modules/cost-engine/compliance-checklist";
import { fmtDate } from "@/shared/datetime";
import "./compliance-evidence.css";

export interface ComplianceEvidence {
  id: string;
  complianceId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  url: string;
  uploadedAt: string;
  uploadedBy: string;
  category: string;
  notes?: string;
}

export function ComplianceEvidenceManager({
  complianceItem,
  evidences = [],
  onUpload,
  onDelete,
}: {
  complianceItem: ComplianceItem;
  evidences?: ComplianceEvidence[];
  onUpload?: (evidence: ComplianceEvidence) => void;
  onDelete?: (id: string) => void;
}) {
  const [dragOver, setDragOver] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    handleFiles(Array.from(files));
  };

  const handleFiles = (files: File[]) => {
    setUploading(true);
    files.forEach(file => {
      // Simulate upload - in real app, upload to server
      const evidence: ComplianceEvidence = {
        id: `evidence-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        complianceId: complianceItem.id,
        fileName: file.name,
        fileType: file.type || file.name.split(".").pop() || "unknown",
        fileSize: file.size,
        url: URL.createObjectURL(file),
        uploadedAt: new Date().toISOString(),
        uploadedBy: "当前用户",
        category: complianceItem.category,
        notes: `${complianceItem.label} - ${file.name}`,
      };
      setTimeout(() => {
        onUpload?.(evidence);
        setUploading(false);
      }, 500);
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  return (
    <div className="compliance-evidence">
      <div className="evidence-header">
        <strong>📎 {complianceItem.label} · 证据</strong>
        <small>{evidences.length}个文件 · {complianceItem.required ? "必需" : "可选"}</small>
      </div>

      <div className={`evidence-drop ${dragOver ? "drag-over" : ""}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        <input type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx,.xls" onChange={handleFileUpload} style={{ display: "none" }} id={`evidence-upload-${complianceItem.id}`} />
        <label htmlFor={`evidence-upload-${complianceItem.id}`} style={{ cursor: "pointer", display: "grid", gap: 4, placeItems: "center" }}>
          <span style={{ fontSize: 20 }}>📤</span>
          <strong style={{ fontSize: 11 }}>拖拽证书/报告到此处或点击上传</strong>
          <small style={{ fontSize: 9, color: "#6b7280" }}>支持PDF/Word/图片/Excel，自动关联到{complianceItem.label}</small>
        </label>
        {uploading && <small style={{ color: "#0b7a4f" }}>上传中...</small>}
      </div>

      <div className="evidence-list">
        {evidences.map(ev => (
          <div key={ev.id} className="evidence-item">
            <div className="evidence-icon">
              {ev.fileType.includes("pdf") ? "📄" : ev.fileType.includes("image") || ev.fileType.includes("jpg") || ev.fileType.includes("png") ? "🖼️" : ev.fileType.includes("sheet") || ev.fileType.includes("excel") ? "📊" : "📎"}
            </div>
            <div className="evidence-info">
              <strong>{ev.fileName}</strong>
              <small>{formatFileSize(ev.fileSize)} · {fmtDate(ev.uploadedAt)} · {ev.uploadedBy}</small>
              {ev.notes && <small className="notes">{ev.notes}</small>}
            </div>
            <div className="evidence-actions">
              <button onClick={() => window.open(ev.url, "_blank")}>👁️ 查看</button>
              <button className="danger" onClick={() => onDelete?.(ev.id)}>🗑️ 删除</button>
            </div>
          </div>
        ))}
        {evidences.length === 0 && <div className="empty">暂无证据，拖拽或点击上传证书/报告</div>}
      </div>

      {evidences.length > 0 && (
        <div className="evidence-summary">
          <small>✅ 已上传 {evidences.length}个证据，满足{complianceItem.label}合规要求</small>
        </div>
      )}
    </div>
  );
}
