"use client";

import React from "react";

/**
 * CollapsibleList —— 全站通用的「默认 N 条 + 查看全部 / 收起」列表。
 *
 * 统一此前散落在 6 个页面的同一约定（Dashboard 挑战报告、trace 审计时间线、
 * 设置页最近审计、产品详情变更审计、顾问提议决策记录、工作简报待决事项）：
 * - 服务端取数窗口内，客户端默认只渲染前 previewCount 条；
 * - 超过 previewCount 时出现 hermes-ghost-btn 折叠按钮，展开后全量渲染，不静默丢弃；
 * - 按钮文案统一「查看全部 {total} {unit}」/「收起」。
 *
 * 不改变数据获取方式：服务端仍需放宽 take 支撑展开视图（各 page.tsx 已按此办理）。
 */

/** 默认收起时展示的条数（与原 Dashboard 挑战报告一致；各面板按信息密度显式传值）。 */
export const DEFAULT_PREVIEW_COUNT = 5;

export interface CollapsibleListProps<T> {
  /** 服务端窗口内的完整列表（展开后的全部可见数据）。 */
  items: T[];
  /** 收起时展示的条数，默认 5。 */
  previewCount?: number;
  /** 单条渲染：参数为 (item, index)，index 是它在完整列表中的下标。与 renderList 二选一。 */
  renderItem?: (item: T, index: number) => React.ReactNode;
  /** 完整内容外层容器的 class（如 hermes-list / hermes-timeline）；不传则不包容器。 */
  listClassName?: string;
  /** 计数单位：默认「条」，工作简报用「件」、顾问决策记录用「条记录」。 */
  unit?: string;
  /**
   * 完整计数覆盖：当按钮数字不等于 items.length 时使用
   * （如工作简报展示的 total 来自 rankDecisions 的归并队列）。
   * 默认取 items.length。
   */
  totalOverride?: number;
  /** 折叠按钮与列表的间距（px），默认 10。 */
  toggleMarginTop?: number;
  /**
   * 自定义列表渲染逃生舱：接收已按折叠状态切片的 visible 数组，自行渲染本体
   * （如 Timeline 这类接收结构化数组而非 children 的子组件）。返回空值时回落
   * renderItem 默认容器。逃生舱不改变折叠与按钮行为。
   */
  renderList?: (visible: T[]) => React.ReactNode;
}

/**
 * 按折叠状态计算应渲染的切片（纯函数，便于单测）。
 * 展开时返回完整列表；收起时返回前 previewCount 条。
 */
export function visiblePreviewItems<T>(items: T[], showAll: boolean, previewCount: number = DEFAULT_PREVIEW_COUNT): T[] {
  return showAll ? items : items.slice(0, previewCount);
}

/**
 * 按钮文案（纯函数，便于单测）：列表为空时返回 null（不渲染按钮）。
 */
export function collapseToggleLabel(itemCount: number, showAll: boolean, unit: string, totalOverride?: number): string | null {
  if (itemCount <= 0) return null;
  const total = totalOverride ?? itemCount;
  return showAll ? "收起" : "查看全部 " + total + " " + unit;
}

export default function CollapsibleList<T>({
  items,
  previewCount = DEFAULT_PREVIEW_COUNT,
  renderItem,
  listClassName,
  unit = "条",
  totalOverride,
  toggleMarginTop = 10,
  renderList,
}: CollapsibleListProps<T>) {
  const [showAll, setShowAll] = React.useState(false);
  const visible = visiblePreviewItems(items, showAll, previewCount);

  // 空列表不渲染任何东西（含空态）：空态展示由各调用方的既有 Empty 分支负责。
  if (items.length === 0) return null;

  const fallbackList =
    renderItem !== undefined ? <div className={listClassName}>{visible.map(renderItem)}</div> : null;
  const listNode = renderList ? (renderList(visible) ?? fallbackList) : fallbackList;

  return (
    <>
      {listNode}
      {items.length > previewCount && (
        <button
          type="button"
          className="hermes-ghost-btn"
          style={{ marginTop: toggleMarginTop }}
          onClick={() => setShowAll((v) => !v)}
        >
          {collapseToggleLabel(items.length, showAll, unit, totalOverride)}
        </button>
      )}
    </>
  );
}
