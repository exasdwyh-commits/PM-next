"use client";
/** Kern 对话外壳：最近会话、输入坞、空态。 */
import { useEffect, useRef, useState } from "react";
import type { ConversationControlOption, ConversationControls, ConversationRuntimeConfig, ConversationSummary, RuntimeStatus, StudioModel } from "../types";
import { I } from "./kit";
import { Bento } from "@/components/kx";
import { DesktopConfirmCard } from "./desktop-confirm-card";

/** 主题识别（本地规则，不调模型）：先按关联产品归组，再按标题+预览关键词，最后进暂未归类。 */
const TOPIC_RULES: { key: string; label: string; re: RegExp }[] = [
  { key: "review", label: "方案评审", re: /评审|review|过会/i },
  { key: "launch", label: "立项决策", re: /立项|go门槛/i },
  { key: "poc", label: "验证与POC", re: /poc|验证|实测|试点|灰度/i },
  { key: "cost", label: "成本与预算", re: /成本|预算|报价|bom|毛利/i },
  { key: "meeting", label: "会议纪要", re: /会议|纪要|周会|例会/i },
  { key: "retro", label: "复盘总结", re: /复盘|总结|日报|周报|月报/i },
  { key: "hire", label: "招聘面试", re: /招聘|面试|offer|入职/i },
  { key: "req", label: "需求与PRD", re: /需求|prd|产品方案|功能方案/i },
  { key: "plan", label: "计划排期", re: /排期|计划|里程碑|路线图/i },
  { key: "kb", label: "知识检索", re: /知识|检索|资料|文档|查一下/i },
];
/** 系列标题的公共词干（去掉末尾"第 N 次/(n)/ n"）：出现 2 次以上才成组。 */
function stemOf(title: string): string {
  return title.replace(/(第[一二三四五六七八九十\d\s]+次|（\d+）|\(\d+\)|\s+\d+)\s*$/, "").trim();
}
function folderOf(c: ConversationSummary, series: Set<string>): { key: string; label: string } {
  if (c.productId && c.productName) return { key: `product:${c.productId}`, label: c.productName };
  const text = `${c.title} ${c.preview ?? ""}`;
  const hit = TOPIC_RULES.find((r) => r.re.test(text));
  if (hit) return { key: `topic:${hit.key}`, label: hit.label };
  const stem = stemOf(c.title);
  if (stem && stem !== c.title.trim() && series.has(stem)) return { key: `series:${stem}`, label: `${stem} 系列` };
  return { key: "__ungrouped", label: "暂未归类" };
}

function RailRow({ c, active, pinned, onPick, onTogglePin, onRename, onArchive }: {
  c: ConversationSummary;
  active: boolean;
  pinned: boolean;
  onPick: (id: string) => void;
  onTogglePin: (id: string) => void;
  onRename: (conversation: ConversationSummary) => void;
  onArchive: (conversation: ConversationSummary) => void;
}) {
  return (
    <li className="m-goal-row" data-active={active ? "true" : undefined} data-pinned={pinned ? "true" : undefined}>
      <button type="button" className="m-goal" aria-current={active ? "true" : undefined} title={c.title} onClick={() => onPick(c.id)}>
        <span className="m-goal-title">{c.title}</span>
        <span className="m-goal-sub">{c.productName || c.preview}</span>
      </button>
      <span className="m-goal-ops">
        <button type="button" className="m-goal-op" aria-label={`${pinned ? "取消置顶" : "置顶"}「${c.title}」`} title={pinned ? "取消置顶" : "置顶"} aria-pressed={pinned} onClick={() => onTogglePin(c.id)}>
          <I.pin />
        </button>
        <button type="button" className="m-goal-op" aria-label={`重命名「${c.title}」`} title="重命名" onClick={() => onRename(c)}>
          <I.pen />
        </button>
        <button type="button" className="m-goal-op" aria-label={`归档「${c.title}」`} title="归档" onClick={() => onArchive(c)}>
          <I.archive />
        </button>
      </span>
    </li>
  );
}

export function Rail({
  user, conversations, activeId, runtime, onPick, onNew, onTrust, onClose, onRename, onArchive,
}: {
  user: StudioModel["user"];
  conversations: ConversationSummary[];
  activeId: string | null;
  runtime: RuntimeStatus;
  onPick: (id: string | null) => void;
  onNew: () => void;
  onTrust: () => void;
  onClose: () => void;
  onRename: (conversation: ConversationSummary) => void;
  onArchive: (conversation: ConversationSummary) => void;
}) {
  // 筛选 + 置顶（本地）：对话多时才出现筛选框；置顶 id 存 localStorage。
  const [filter, setFilter] = useState("");
  const [pinned, setPinned] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("kern.rail.pinned.v1");
      if (raw) setPinned(JSON.parse(raw));
    } catch { /* 忽略，保持自然排序 */ }
  }, []);
  const togglePin = (id: string) => setPinned((prev) => {
    const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    try { localStorage.setItem("kern.rail.pinned.v1", JSON.stringify(next)); } catch { /* 忽略 */ }
    return next;
  });
  const q = filter.trim();
  const filtered = conversations
    .filter((c) => !q || c.title.includes(q) || (c.preview ?? "").includes(q) || (c.productName ?? "").includes(q));
  const visible = [...filtered]
    .sort((a, b) => Number(pinned.includes(b.id)) - Number(pinned.includes(a.id)));
  // 主题视图：置顶单独成组，其余按 folderOf 归组；折叠与视图偏好存本机。
  const [groupMode, setGroupMode] = useState<"time" | "topic">("topic");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => {
    try {
      if (localStorage.getItem("kern.rail.view.v1") === "time") setGroupMode("time");
      const raw = localStorage.getItem("kern.rail.collapsed.v1");
      if (raw) setCollapsed(JSON.parse(raw));
    } catch { /* 忽略 */ }
  }, []);
  const switchMode = (mode: "time" | "topic") => {
    setGroupMode(mode);
    try { localStorage.setItem("kern.rail.view.v1", mode); } catch { /* 忽略 */ }
  };
  const toggleFolder = (key: string) => setCollapsed((prev) => {
    const next = prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key];
    try { localStorage.setItem("kern.rail.collapsed.v1", JSON.stringify(next)); } catch { /* 忽略 */ }
    return next;
  });
  const topicFolders = (() => {
    const stemCount = new Map<string, number>();
    for (const c of filtered) {
      const stem = stemOf(c.title);
      if (stem && stem !== c.title.trim()) stemCount.set(stem, (stemCount.get(stem) ?? 0) + 1);
    }
    const series = new Set([...stemCount.entries()].filter(([, n]) => n >= 2).map(([s]) => s));
    const map = new Map<string, { key: string; label: string; items: ConversationSummary[] }>();
    for (const c of filtered) {
      if (pinned.includes(c.id)) continue;
      const f = folderOf(c, series);
      const g = map.get(f.key) ?? { ...f, items: [] };
      g.items.push(c);
      map.set(f.key, g);
    }
    // 落单的系列（组内不足 2 条）并回暂未归类，避免出现只有 1 条的"系列"。
    const groups = [...map.values()];
    const singles = groups.filter((g) => g.key.startsWith("series:") && g.items.length < 2);
    if (singles.length > 0) {
      const rest = groups.filter((g) => !(g.key.startsWith("series:") && g.items.length < 2));
      let ung = rest.find((g) => g.key === "__ungrouped");
      if (!ung) {
        ung = { key: "__ungrouped", label: "暂未归类", items: [] };
        rest.push(ung);
      }
      for (const s of singles) ung.items.push(...s.items);
      return rest;
    }
    return groups;
  })();
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
        <div className="m-rail-list-head">
          <h2 className="m-rail-label">最近对话</h2>
          <div className="m-seg m-rail-view" role="group" aria-label="排列方式">
            <button type="button" aria-pressed={groupMode === "time"} onClick={() => switchMode("time")}>时间</button>
            <button type="button" aria-pressed={groupMode === "topic"} onClick={() => switchMode("topic")}>主题</button>
          </div>
          <span className="m-rail-count" aria-label={`${visible.length} 段对话`}>{filter ? `${visible.length}/${conversations.length}` : conversations.length}</span>
        </div>
        {conversations.length > 6 ? (
          <div className="m-rail-filter-wrap">
            <input
              className="m-rail-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="筛选对话"
              aria-label="按标题筛选对话"
            />
          </div>
        ) : null}
        {groupMode === "time" ? (
          <ul className="m-goal-list">
            {visible.map((conversation) => (
              <RailRow
                key={conversation.id}
                c={conversation}
                active={activeId === conversation.id}
                pinned={pinned.includes(conversation.id)}
                onPick={onPick}
                onTogglePin={togglePin}
                onRename={onRename}
                onArchive={onArchive}
              />
            ))}
          </ul>
        ) : (
          <div className="m-folders">
            {pinned.length > 0 && filtered.some((c) => pinned.includes(c.id)) ? (
              <section className="m-folder" aria-label="置顶">
                <button
                  type="button"
                  className="m-folder-h"
                  aria-expanded={!collapsed.includes("__pinned")}
                  onClick={() => toggleFolder("__pinned")}
                >
                  <span className="m-folder-name">置顶</span>
                  <span className="m-rail-count">{filtered.filter((c) => pinned.includes(c.id)).length}</span>
                  <span className="m-folder-caret" aria-hidden>{collapsed.includes("__pinned") ? "▸" : "▾"}</span>
                </button>
                {!collapsed.includes("__pinned") ? (
                  <ul className="m-goal-list">
                    {filtered.filter((c) => pinned.includes(c.id)).map((conversation) => (
                      <RailRow
                        key={conversation.id}
                        c={conversation}
                        active={activeId === conversation.id}
                        pinned
                        onPick={onPick}
                        onTogglePin={togglePin}
                        onRename={onRename}
                        onArchive={onArchive}
                      />
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}
            {topicFolders.map((g) => (
              <section key={g.key} className="m-folder" aria-label={g.label}>
                <button
                  type="button"
                  className="m-folder-h"
                  aria-expanded={!collapsed.includes(g.key)}
                  onClick={() => toggleFolder(g.key)}
                >
                  <span className="m-folder-name">{g.label}</span>
                  <span className="m-rail-count">{g.items.length}</span>
                  <span className="m-folder-caret" aria-hidden>{collapsed.includes(g.key) ? "▸" : "▾"}</span>
                </button>
                {!collapsed.includes(g.key) ? (
                  <ul className="m-goal-list">
                    {g.items.map((conversation) => (
                      <RailRow
                        key={conversation.id}
                        c={conversation}
                        active={activeId === conversation.id}
                        pinned={false}
                        onPick={onPick}
                        onTogglePin={togglePin}
                        onRename={onRename}
                        onArchive={onArchive}
                      />
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
        )}
        {conversations.length === 0 ? (
          <p className="m-hint" style={{ margin: "4px 8px" }}>还没有对话。</p>
        ) : visible.length === 0 ? (
          <p className="m-hint" style={{ margin: "4px 8px" }}>没有匹配“{filter}”的对话。</p>
        ) : null}
      </div>
      <div className="m-rail-foot">
        {/* 桌面端工作台入口在顶部上下文栏；手机端顶栏放不下，放回侧栏抽屉 */}
        <a className="m-new m-rail-mgmt" href="/manage">
          <I.plan />
          工作台
        </a>
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

type RunTab = "advisors" | "skills" | "capabilities";
const RUN_TABS: { key: RunTab; label: string; field: "advisorCodes" | "skillKeys" | "capabilityKeys" }[] = [
  { key: "capabilities", label: "功能", field: "capabilityKeys" },
  { key: "advisors", label: "顾问", field: "advisorCodes" },
  { key: "skills", label: "技能", field: "skillKeys" },
];

/** 多选：取消到一个不剩时回到「自动」，而不是变成「全部禁用」。 */
function toggleKey(value: string[] | null, key: string): string[] | null {
  const current = value ?? [];
  const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
  return next.length ? next : null;
}

/**
 * 运行配置：一个按钮 + 一个向上弹出的面板。
 * 按钮上直接显示当前模型；点面板外或按 Esc 收起；同时只会有一个面板打开。
 */
function RunControls({
  controls,
  config,
  onChange,
}: {
  controls: ConversationControls;
  config: ConversationRuntimeConfig;
  onChange: (next: Partial<ConversationRuntimeConfig>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<RunTab>("capabilities");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const model = controls.models.find((option) => option.key === config.modelProfileKey);
  // 选过的模型如果已被停用，明确告诉用户，而不是静默显示成「自动」
  const staleModel = config.modelProfileKey !== null && !model;
  const custom = RUN_TABS.filter((t) => config[t.field] !== null).length;
  const active = RUN_TABS.find((t) => t.key === tab)!;
  const options: ConversationControlOption[] = controls[active.key];
  const picked = config[active.field];

  return (
    <div className="m-advanced-controls" ref={ref} data-open={open ? "true" : undefined}>
      <button
        type="button"
        className="m-auto-mode"
        aria-label="高级运行配置"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="m-auto-dot" aria-hidden data-t={staleModel ? "warn" : undefined} />
        <span>{model ? model.label : staleModel ? "模型已停用" : "Auto · Kern"}</span>
        {custom ? <small>+{custom} 项自定义</small> : <small>高级</small>}
        <svg className="m-auto-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M2.5 6.2 5 3.8l2.5 2.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open ? (
        <div className="m-run-panel" role="dialog" aria-label="Conversation 高级运行配置">
          <section className="m-run-sec">
            <h4>模型</h4>
            <div className="m-run-list" role="radiogroup" aria-label="模型">
              <button type="button" role="radio" className="m-control-row" aria-checked={config.modelProfileKey === null}
                onClick={() => { onChange({ modelProfileKey: null }); setOpen(false); }}>
                <span><b>Auto</b><small>Kern 按任务类型和策略自动选择</small></span>
                <i>{config.modelProfileKey === null ? "✓" : ""}</i>
              </button>
              {controls.models.map((option) => (
                <button key={option.key} type="button" role="radio" className="m-control-row" aria-checked={config.modelProfileKey === option.key}
                  onClick={() => { onChange({ modelProfileKey: option.key }); setOpen(false); }}>
                  <span><b>{option.label}</b><small>{option.meta ? `${option.meta} · ` : ""}{option.description}</small></span>
                  <i>{config.modelProfileKey === option.key ? "✓" : ""}</i>
                </button>
              ))}
              {staleModel ? (
                <p className="m-control-empty" data-t="warn">之前选的模型已被停用，发送时会按 Auto 处理。</p>
              ) : null}
              {controls.models.length === 0 ? (
                <p className="m-control-empty">
                  还没有可用的模型，Kern 会以无模型模式回答。
                  <a href="/settings">去设置里配置 →</a>
                </p>
              ) : null}
            </div>
          </section>
          <section className="m-run-sec">
            <div className="m-run-tabs" role="tablist" aria-label="能力范围">
              {RUN_TABS.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>
                  {t.label}
                  <small>{config[t.field] === null ? "自动" : `${config[t.field]!.length}`}</small>
                </button>
              ))}
            </div>
            <div className="m-run-chips">
              <button type="button" className="m-run-chip" aria-pressed={picked === null} onClick={() => onChange({ [active.field]: null })}>
                自动
              </button>
              {options.map((option) => (
                <button key={option.key} type="button" className="m-run-chip" title={option.description}
                  aria-pressed={picked !== null && picked.includes(option.key)}
                  onClick={() => onChange({ [active.field]: toggleKey(picked, option.key) })}>
                  {option.label}
                </button>
              ))}
              {options.length === 0 ? <span className="m-control-empty">暂无可选项，Kern 会自动决定。</span> : null}
            </div>
            <p className="m-run-hint">
              {picked === null ? "Kern 会根据任务自己选择。" : `只使用选中的 ${picked.length} 项。全部取消即回到自动。`}
            </p>
          </section>
        </div>
      ) : null}
    </div>
  );
}

const SLASH_COMMANDS = [
  { cmd: "/评审", hint: "评审方案的可行性与风险", text: "评审以下方案的可行性、风险和改进建议：" },
  { cmd: "/总结", hint: "总结结论与待办", text: "总结一下这次对话的结论和待办事项：" },
  { cmd: "/排期", hint: "排里程碑和时间", text: "把这项工作排个期，给出里程碑和时间点：" },
  { cmd: "/日报", hint: "生成今日工作日报", text: "生成今日工作日报，包括完成项、阻塞项和明日计划：" },
];

export function Dock({
  value,
  onChange,
  draftSaved,
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
  draftSaved: boolean;
  onSend: () => void;
  sending: boolean;
  controls: ConversationControls;
  config: ConversationRuntimeConfig;
  onConfigChange: (config: ConversationRuntimeConfig) => void;
  capabilities: string[];
  onTrust: () => void;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  useEffect(() => {
    const input = ta.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
  }, [value]);
  const patch = (next: Partial<ConversationRuntimeConfig>) =>
    onConfigChange({ ...config, ...next });
  // slash 快捷指令：以 / 开头且无空格时弹出模板，选中填入输入框（不直接发送）。
  const slashQuery = value.match(/^\/(\S*)$/)?.[1] ?? null;
  const slashHits = slashQuery === null ? [] : SLASH_COMMANDS.filter((c) => c.cmd.startsWith(`/${slashQuery}`));
  const [slashActive, setSlashActive] = useState(0);
  useEffect(() => { setSlashActive(0); }, [slashQuery]);
  const pickSlash = (index: number) => {
    const hit = slashHits[index];
    if (!hit) return;
    onChange(hit.text);
    requestAnimationFrame(() => ta.current?.focus());
  };

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
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={(e) => {
            if (composing.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
            if (slashHits.length > 0) {
              if (e.key === "ArrowDown") { e.preventDefault(); setSlashActive((i) => (i + 1) % slashHits.length); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setSlashActive((i) => (i - 1 + slashHits.length) % slashHits.length); return; }
              if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") { e.preventDefault(); pickSlash(slashActive); return; }
              if (e.key === "Escape") { e.preventDefault(); onChange(""); return; }
            }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
          }}
          placeholder="给 Kern 发消息，或直接交代一件事（/ 有快捷指令）"
          aria-label="对 Kern 说"
          aria-expanded={slashHits.length > 0}
          aria-controls={slashHits.length > 0 ? "m-slash-menu" : undefined}
          role="combobox"
          aria-autocomplete="list"
        />
        {slashHits.length > 0 ? (
          <div className="m-slash" id="m-slash-menu" role="listbox" aria-label="快捷指令">
            {slashHits.map((hit, i) => (
              <button
                key={hit.cmd}
                type="button"
                role="option"
                aria-selected={i === slashActive}
                data-on={i === slashActive ? "true" : undefined}
                className="m-slash-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickSlash(i)}
                onMouseEnter={() => setSlashActive(i)}
              >
                <b>{hit.cmd}</b>
                <span>{hit.hint}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="m-dock-bar">
          <RunControls controls={controls} config={config} onChange={patch} />
          <button type="button" className="m-pill m-runtime-pill" onClick={onTrust}>
            <I.mac />
            {capabilities.length} 项本机能力
          </button>
          {draftSaved && value.trim() ? <span className="m-kbd">草稿已保存</span> : null}
          <span className="m-kbd">Enter 发送 · Shift+Enter 换行</span>
          <button type="submit" className="m-send" disabled={sending || value.trim().length === 0} aria-label={sending ? "正在发送" : "发送"} aria-busy={sending}>
            <I.send />
          </button>
        </div>
      </form>
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "夜深了" : h < 11 ? "早上好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好";
}

export function Blank({
  seeds,
  attention,
  userName,
  onSeed,
  onOpen,
}: {
  seeds: { id: string; title: string; why: string; prompt: string }[];
  attention?: {
    needsYou: {
      id: string; level: string; title: string; why: string; href: string | null; conversationId: string | null;
      confirm?: { taskId: string; label: string; detail: string; reason: string };
    }[];
    inProgress: { id: string; title: string; why: string; conversationId: string | null }[];
    handledQuietly: number;
    completedRecently?: number;
  };
  userName?: string;
  onSeed: (p: string) => void;
  onOpen?: (conversationId: string) => void;
}) {
  const needs = attention?.needsYou ?? [];
  const doing = attention?.inProgress ?? [];
  // 稍后处理（本地分诊，不动服务端）：id 存 localStorage，已处理消失的 id 下次写入时自然淘汰。
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("kern.home.dismissedNeeds.v1");
      if (raw) setDismissed(JSON.parse(raw));
    } catch { /* 无痕模式等直接忽略，保持全量展示 */ }
  }, []);
  const snooze = (id: string, off: boolean) => setDismissed((prev) => {
    const next = off ? prev.filter((x) => x !== id) : [...prev, id];
    try { localStorage.setItem("kern.home.dismissedNeeds.v1", JSON.stringify(next)); } catch { /* 忽略 */ }
    return next;
  });
  const live = needs.filter((n) => !dismissed.includes(n.id));
  const snoozed = needs.filter((n) => dismissed.includes(n.id));
  const open = (item: { href: string | null; conversationId: string | null }) => {
    if (item.conversationId && onOpen) onOpen(item.conversationId);
    else if (item.href) window.location.href = item.href;
  };
  return (
    <div className="m-home">
      <header className="m-home-head">
        {/* 2026-10-04：移除此处 <span className="m-blank-orb" aria-hidden />。
           它是纯装饰元素（无内容、aria-hidden），KX-60 令牌迁移后被覆盖成
           36px 的圆角方块并关掉呼吸动画，实际渲染为一个无意义的蓝色方块。
           DESIGN.md「Motion」明确不使用循环装饰动画、「Avoid」明确不堆装饰性
           光晕；此处既无信息也无动作，故移除而不是修圆。 */}
        <div>
          <h2 suppressHydrationWarning>{greeting()}{userName ? `，${userName.replace(/\s*[（(].*$/, "")}` : ""}</h2>
          <p>
            {needs.length ? `有 ${needs.length} 件事需要你。` : "目前没有需要你操心的事。"}
            {attention?.completedRecently ? `过去一天完成了 ${attention.completedRecently} 项工作。` : ""}
            {doing.length
              ? `Kern 正在推进 ${doing.length} 项工作。`
              : "直接说目标，能做的我会自己推进。"}
            {attention?.handledQuietly ? ` 另有 ${attention.handledQuietly} 项已安静处理完。` : ""}
          </p>
        </div>
      </header>

      {needs.length > 0 && (
        <section className="m-home-sec" aria-label="需要你">
          <div className="m-home-sec-head">
            <h3>需要你{live.length !== needs.length ? `（剩 ${live.length} 项）` : ""}</h3>
            {snoozed.length > 0 ? (
              <button type="button" className="m-link" onClick={() => snoozed.forEach((n) => snooze(n.id, true))}>
                已稍后 {snoozed.length} 项，全部恢复
              </button>
            ) : null}
          </div>
          {live.map((item) => item.confirm ? (
            <div key={item.id} className="m-row-wrap">
              <div className="m-row-wrap-main"><DesktopConfirmCard {...item.confirm} /></div>
              <button type="button" className="m-row-snooze" onClick={() => snooze(item.id, false)} title="稍后处理">稍后</button>
            </div>
          ) : (
            <div key={item.id} className="m-row-wrap">
              <button type="button" className={`m-row ${item.level === "INTERRUPT" ? "is-hot" : ""}`} onClick={() => open(item)}>
                <i className="m-row-dot" aria-hidden />
                <span className="m-row-main"><b>{item.title}</b><small>{item.why}</small></span>
                <span className="m-row-go" aria-hidden>›</span>
              </button>
              <button type="button" className="m-row-snooze" onClick={() => snooze(item.id, false)} title="稍后处理">稍后</button>
            </div>
          ))}
        </section>
      )}

      {doing.length > 0 && (
        <section className="m-home-sec" aria-label="Kern 正在做">
          <h3>Kern 正在做</h3>
          {doing.map((item) => (
            <button key={item.id} type="button" className="m-row is-live" onClick={() => open({ href: null, conversationId: item.conversationId })}>
              <i className="m-row-dot" aria-hidden />
              <span className="m-row-main"><b>{item.title}</b><small>{item.why}</small></span>
              <span className="m-row-go" aria-hidden>›</span>
            </button>
          ))}
        </section>
      )}

      <section className="m-home-sec" aria-label="开始">
        <h3>交给 Kern</h3>
        <Bento label="可以直接交给 Kern 的事" tiles={seeds.map((s) => ({ id: s.id, title: s.title, hint: s.why }))} onPick={(id) => onSeed(seeds.find((s) => s.id === id)?.prompt ?? "")} />
      </section>
    </div>
  );
}
