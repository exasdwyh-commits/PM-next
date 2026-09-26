"use client";
/** Kern 对话外壳：最近会话、输入坞、空态。 */
import { useRef } from "react";
import type { ConversationControlOption, ConversationControls, ConversationRuntimeConfig, ConversationSummary, RuntimeStatus, StudioModel } from "../types";
import { Btn, I } from "./kit";

export function Rail({
  user, conversations, activeId, runtime, onPick, onNew, onTrust, onClose,
}: {
  user: StudioModel["user"];
  conversations: ConversationSummary[];
  activeId: string | null;
  runtime: RuntimeStatus;
  onPick: (id: string | null) => void;
  onNew: () => void;
  onTrust: () => void;
  onClose: () => void;
}) {
  return (
    <nav className="m-rail" aria-label="Kern 对话">
      <div className="m-brand">
        <span className="m-brand-mark" aria-hidden>K</span>
        <b>Kern</b>
        <button type="button" className="m-btn m-rail-x" data-v="ghost" data-size="sm" onClick={onClose} aria-label="收起侧栏">
          <I.close />
        </button>
      </div>
      <button type="button" className="m-new" onClick={onNew}>
        <I.plus />
        新对话
      </button>
      <div className="m-rail-scroll">
        <p className="m-rail-label">最近对话</p>
        {conversations.map((conversation) => (
          <button key={conversation.id} type="button" className="m-goal" aria-current={activeId === conversation.id ? "true" : undefined} onClick={() => onPick(conversation.id)}>
            <span className="m-goal-title">{conversation.title}</span>
            <span className="m-goal-sub">{conversation.productName || conversation.preview}</span>
          </button>
        ))}
        {conversations.length === 0 ? (
          <p className="m-hint" style={{ margin: "4px 8px" }}>还没有对话。</p>
        ) : null}
      </div>
      <div className="m-rail-foot">
        <button type="button" className="m-new" onClick={() => { window.location.href = "/manage"; }}>
          <I.plan />
          工作台
        </button>
        <button type="button" className="m-me" onClick={onTrust}>
          <span className="m-me-av" aria-hidden>我</span>
          <span>
            <b>{user.name}</b>
            <small>{runtime.connected ? `已接入 ${runtime.host}` : "本机未接入"}</small>
          </span>
          <I.shield />
        </button>
      </div>
    </nav>
  );
}

function selectedLabel(
  options: ConversationControlOption[],
  keys: string[] | null,
  autoLabel = "自动"
) {
  if (keys === null) return autoLabel;
  if (keys.length === 0) return "无";
  if (keys.length === 1) {
    return options.find((option) => option.key === keys[0])?.label || "1 项";
  }
  return `${keys.length} 项`;
}

function MultiControl({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ConversationControlOption[];
  value: string[] | null;
  onChange: (value: string[] | null) => void;
}) {
  const toggle = (key: string) => {
    const current = value ?? [];
    onChange(
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    );
  };

  return (
    <details className="m-control">
      <summary className="m-pill">
        {label} · {selectedLabel(options, value)}
      </summary>
      <div className="m-control-menu">
        <button
          type="button"
          className="m-control-row"
          aria-pressed={value === null}
          onClick={() => onChange(null)}
        >
          <span>
            <b>自动</b>
            <small>由 Kern 根据任务自己选择</small>
          </span>
          <i>{value === null ? "✓" : ""}</i>
        </button>
        {options.map((option) => {
          const checked = value !== null && value.includes(option.key);
          return (
            <button
              key={option.key}
              type="button"
              className="m-control-row"
              aria-pressed={checked}
              onClick={() => toggle(option.key)}
            >
              <span>
                <b>{option.label}</b>
                <small>{option.description}</small>
              </span>
              <i>{checked ? "✓" : ""}</i>
            </button>
          );
        })}
      </div>
    </details>
  );
}

function ModelControl({
  options,
  value,
  onChange,
}: {
  options: ConversationControlOption[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const current = options.find((option) => option.key === value);
  return (
    <details className="m-control">
      <summary className="m-pill">模型 · {current?.label || "自动"}</summary>
      <div className="m-control-menu">
        <button
          type="button"
          className="m-control-row"
          aria-pressed={value === null}
          onClick={() => onChange(null)}
        >
          <span>
            <b>自动</b>
            <small>按任务类型和策略自动路由</small>
          </span>
          <i>{value === null ? "✓" : ""}</i>
        </button>
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            className="m-control-row"
            aria-pressed={value === option.key}
            onClick={() => onChange(option.key)}
          >
            <span>
              <b>{option.label}</b>
              <small>{option.meta ? `${option.meta} · ` : ""}{option.description}</small>
            </span>
            <i>{value === option.key ? "✓" : ""}</i>
          </button>
        ))}
        {options.length === 0 ? (
          <p className="m-control-empty">没有已启用且已配置运行时的模型。</p>
        ) : null}
      </div>
    </details>
  );
}

export function Dock({
  value,
  onChange,
  onSend,
  sending,
  controls,
  config,
  onConfigChange,
  capabilities,
  onTrust,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  controls: ConversationControls;
  config: ConversationRuntimeConfig;
  onConfigChange: (config: ConversationRuntimeConfig) => void;
  capabilities: string[];
  onTrust: () => void;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const patch = (next: Partial<ConversationRuntimeConfig>) =>
    onConfigChange({ ...config, ...next });

  return (
    <div className="m-dock">
      <form
        className="m-dock-inner"
        onSubmit={(e) => { e.preventDefault(); onSend(); }}
      >
        <textarea
          ref={ta}
          value={value}
          rows={1}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
          }}
          placeholder="给 Kern 发消息，或直接交代一件事"
          aria-label="对 Kern 说"
        />
        <div className="m-dock-bar">
          <div className="m-control-strip" aria-label="Conversation 运行配置">
            <ModelControl
              options={controls.models}
              value={config.modelProfileKey}
              onChange={(modelProfileKey) => patch({ modelProfileKey })}
            />
            <MultiControl
              label="顾问"
              options={controls.advisors}
              value={config.advisorCodes}
              onChange={(advisorCodes) => patch({ advisorCodes })}
            />
            <MultiControl
              label="技能"
              options={controls.skills}
              value={config.skillKeys}
              onChange={(skillKeys) => patch({ skillKeys })}
            />
            <MultiControl
              label="功能"
              options={controls.capabilities}
              value={config.capabilityKeys}
              onChange={(capabilityKeys) => patch({ capabilityKeys })}
            />
          </div>
          <button type="button" className="m-pill m-runtime-pill" onClick={onTrust}>
            <I.mac />
            {capabilities.length} 项本机能力
          </button>
          <span className="m-kbd">Enter 发送 · Shift+Enter 换行</span>
          <button type="submit" className="m-send" disabled={sending || value.trim().length === 0} aria-label="发送">
            <I.send />
          </button>
        </div>
      </form>
    </div>
  );
}

export function Blank({ seeds, onSeed }: { seeds: { id: string; title: string; why: string; prompt: string }[]; onSeed: (p: string) => void }) {
  return (
    <div className="m-blank">
      <span className="m-blank-orb" aria-hidden />
      <h2>有什么需要我做的？</h2>
      <p>直接说目标。能做的我会自己推进，真正需要你决定时再问。</p>
      <div className="m-seeds">
        {seeds.map((s) => (
          <button key={s.id} type="button" className="m-seed" onClick={() => onSeed(s.prompt)}>
            <b>{s.title}</b>
            <small>{s.why}</small>
          </button>
        ))}
      </div>
      <Btn size="sm" onClick={() => onSeed("")}>自己写</Btn>
    </div>
  );
}
