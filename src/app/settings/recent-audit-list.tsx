"use client";

import CollapsibleList from "@/components/collapsible-list";
import { Empty } from "@/components/ui";
import { labelAuditAction } from "@/shared/status-labels";
import { fmtDateTime } from "@/shared/datetime";

/**
 * 设置页「最近审计事件」列表（客户端折叠）。
 *
 * 服务端取最近 100 条（settings/page.tsx），本组件默认只展示前 10 条，
 * 其余通过「查看全部 / 收起」展开 —— 全站统一走 CollapsibleList 组件。
 */
const AUDIT_PREVIEW_COUNT = 10;

export default function RecentAuditList({ audits }: { audits: any[] }) {
  if (audits.length === 0) return <Empty>还没有审计事件。完成一次受治理的配置、审批或业务变更后，会在这里留下记录。</Empty>;

  return (
    <CollapsibleList
      items={audits}
      previewCount={AUDIT_PREVIEW_COUNT}
      listClassName="hermes-timeline"
      renderItem={(a: any) => (
        <div key={a.id} className="hermes-row">
          <div className="hermes-row-head">
            <span className="hermes-row-title">{labelAuditAction(a.action)}</span>
            <span className="muted-line">{fmtDateTime(a.timestamp)}</span>
          </div>
          <div className="hermes-row-meta">
            <span>{a.summary}</span>
            {a.actor?.name && <span>操作人 {a.actor.name}</span>}
          </div>
        </div>
      )}
    />
  );
}
