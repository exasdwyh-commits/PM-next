"use client";

import * as React from "react";
import { Count, Drawer, Meter, Tag } from "@/components/kx";
import { MotionPreference } from "@/components/motion/motion-preference";
import "./settings.css";

/**
 * KX-22 设置页（方案 B：概览卡片 + 下钻）。
 *
 * 顶部本月用量 → 四张概览卡（账户 / 组织与权限 / 知识连接 / 模型，各一行状态 + 两行要点 + 管理）→ 最近审计。
 * 点「管理」在右侧抽屉里打开完整面板；面板内容由服务端渲染后作为 slot 传入，这里只负责开合。
 * 旧锚点 /settings#models、/settings#usage 会直接打开对应抽屉。
 */

export type SettingsSection = "acct" | "org" | "know" | "model" | "usage";
type Tone = "ok" | "warn" | "bad" | "";

export interface SettingsCard {
  key: Exclude<SettingsSection, "usage">;
  title: string;
  tone: Tone;
  statusText: string;
  line1: string;
  line2: string;
}

export interface UsageMeter {
  label: string;
  used: number;
  limit: number | null;
}

const TITLES: Record<SettingsSection, string> = {
  acct: "账户",
  org: "组织与权限",
  know: "知识连接",
  model: "模型",
  usage: "用量与审计",
};

const HASH_TO_SECTION: Record<string, SettingsSection> = {
  "#account": "acct",
  "#org": "org",
  "#knowledge": "know",
  "#models": "model",
  "#usage": "usage",
};

export default function SettingsOverview({
  period,
  meters,
  limitNote,
  cards,
  auditCount,
  auditPreview,
  panels,
}: {
  period: string;
  meters: UsageMeter[];
  limitNote: string | null;
  cards: SettingsCard[];
  auditCount: number;
  auditPreview: React.ReactNode;
  panels: Record<SettingsSection, React.ReactNode>;
}) {
  const [open, setOpen] = React.useState<SettingsSection | null>(null);

  const close = React.useCallback(() => {
    setOpen(null);
    if (window.location.hash && HASH_TO_SECTION[window.location.hash]) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  React.useEffect(() => {
    const fromHash = () => {
      const key = HASH_TO_SECTION[window.location.hash];
      setOpen(key ?? null);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  return (
    <div className="kx-st">
      <section className="kx-st-card" aria-labelledby="kx-st-usage">
        <div className="kx-st-card-h">
          <h2 id="kx-st-usage">本月用量</h2>
          <small>{period} · 演示运行不计入</small>
          <button type="button" className="kx-st-link" onClick={() => setOpen("usage")}>
            用量与审计 →
          </button>
        </div>
        <div className="kx-st-meters">
          {meters.map((m) => (
            <Meter key={m.label} label={m.label} used={m.used} limit={m.limit} />
          ))}
        </div>
        {limitNote ? <p className="kx-st-note">{limitNote}</p> : null}
      </section>

      <div className="kx-st-grid">
        {cards.map((card) => (
          <section key={card.key} className="kx-st-card" aria-labelledby={`kx-st-${card.key}`}>
            <div className="kx-st-card-h">
              <h2 id={`kx-st-${card.key}`}>{card.title}</h2>
              <Tag tone={card.tone}>{card.statusText}</Tag>
            </div>
            <div className="kx-st-card-b">
              <p className="kx-st-l1">{card.line1}</p>
              <p className="kx-st-l2">{card.line2}</p>
              <button
                type="button"
                className="hermes-outline-btn hermes-btn-sm"
                onClick={() => setOpen(card.key)}
              >
                管理 →
              </button>
            </div>
          </section>
        ))}
      </div>

      <section className="kx-st-card" aria-labelledby="kx-st-audit">
        <div className="kx-st-card-h">
          <h2 id="kx-st-audit">最近审计</h2>
          <Count n={auditCount} />
          <button type="button" className="kx-st-link" onClick={() => setOpen("usage")}>
            全部 →
          </button>
        </div>
        <div className="kx-st-card-b">{auditPreview}</div>
      </section>

      <MotionPreference />

      <Drawer title={open ? TITLES[open] : ""} open={open !== null} onClose={close}>
        {open ? panels[open] : null}
      </Drawer>
    </div>
  );
}

/** 账户面板里的「复制组织短码」：复制完整组织 ID，界面只显示短码。 */
export function CopyOrgId({ value }: { value: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <button
      type="button"
      className="hermes-outline-btn hermes-btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          window.setTimeout(() => setDone(false), 1600);
        } catch {
          setDone(false);
        }
      }}
      aria-label="复制完整组织 ID"
    >
      {done ? "已复制" : "复制"}
    </button>
  );
}
