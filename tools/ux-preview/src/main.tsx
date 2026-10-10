import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Rail, Blank, Dock } from '@/app/muse/components/shell';
import { KernRoleBar } from '@/app/muse/components/kern-role-bar';
import { ConversationTools, type ConversationTool } from '@/app/muse/components/conversation-tools';
import { DailyBriefing } from '@/app/muse/components/daily-briefing';
import { RoleProvider } from '@/components/role-context';
import { Btn, I } from '@/app/muse/components/kit';
import { studioModel } from '@/app/muse/mock-data';
import WorkbenchClient from '@/app/workbench-client';
import type { DailyBriefingOutput } from '@/modules/assistant-runtime/capabilities/daily-briefing';
import '@/app/globals.css';
import '@/app/muse/muse.css';
import '@/app/muse/home-experience.css';
import './preview.css';

type Scenario = 'empty' | 'project' | 'existing' | 'error' | 'warning';
const PREVIEW_BASE = window.location.protocol.startsWith('http') ? window.location.origin : 'https://pm-next-preview.local';
const STAMP = '2026-10-10T01:55:00.000Z';
const EMPTY_BRIEF: DailyBriefingOutput = {
  todos: 0, decisions: 0, gaps: 0, risks: 0, evidenceRate: 0, workRate: 0,
  verifiedCount: 0, totalEvidence: 0, doneWork: 0, totalWork: 0,
  category: 'health_food', projectCount: 0, scopeLabel: '最近 5 个项目（非组织全量）', suggestions: [], generatedAt: STAMP,
};
const PROJECT_BRIEF: DailyBriefingOutput = {
  ...EMPTY_BRIEF, projectCount: 1, projectId: 'preview-project', projectTitle: '新品第一轮验证',
  totalEvidence: 8, verifiedCount: 5, evidenceRate: 63, totalWork: 5, doneWork: 2, todos: 3, workRate: 40, gaps: 3, decisions: 1,
  suggestions: ['审查 1 项待决策事项', '核实 3 条尚未核实的证据', '梳理 3 项未完成工作和负责人'],
};
const runtime = { connected: false, host: '未连接', lastHeartbeat: '未上报', capabilities: [], activeAction: null };
const emptyActivity = {
  generatedAt: STAMP, since: '2026-10-09T01:55:00.000Z', windowHours: 24, eventCount: 0, triggeredCount: 0, suppressedCount: 0,
  waitingPolicyCount: 0, failedCount: 0, waitingHumanCount: 0, returnReviewCount: 0, attentionCount: 0, attentionItems: [], recentTraces: [],
};
const emptyOverview = {
  meta: { generatedAt: STAMP, scopeLabel: '预览工作空间', permissionLabel: '示例数据 · 不代表你的真实工作空间' },
  todos: { count: 0, items: [] }, pendingDecisions: { count: 0, items: [] },
  productsInFlight: { count: 0, byStage: [], items: [] }, blockers: { count: 0, items: [] }, opportunities: { count: 0, items: [] },
  recentlyCompleted: { count: 0, items: [] }, portfolio: { productCount: 0, projectCount: 0 },
};

// 只在这个独立预览项目里拦截 API；正式源代码没有 fake API 或认证旁路。
const network = window.fetch.bind(window);
let scenario: Scenario = 'empty';
let failures = 0;
(window as any).__previewRequests = [];
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url, PREVIEW_BASE);
  if (!url.pathname.startsWith('/api/')) return network(input, init);
  (window as any).__previewRequests.push({ path: url.pathname, method: init?.method || 'GET' });
  if (init?.method && init.method !== 'GET') return new Response(JSON.stringify({ message: '只读预览：没有执行任何写入。' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  if (url.pathname === '/api/memory/role') return Response.json({ preference: null });
  if (url.pathname === '/api/desktop-runtime/overview') return Response.json({
    presence: { status: 'UNKNOWN', deviceId: null, lastSeenAt: null, secondsSinceLastSeen: null, label: '本机未连接', hint: null },
    waitingRuntimeCount: 0, runningCount: 0, needsYouCount: 0, tasks: [], generatedAt: STAMP,
  });
  if (url.pathname === '/api/assistant/daily-briefing') {
    const captured = scenario;
    const failed = failures-- > 0;
    await new Promise<void>((resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      const timer = window.setTimeout(resolve, 240);
      signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
    if (failed) return Response.json({ message: '读取失败（演示）' }, { status: 503 });
    const briefing = captured === 'project' ? PROJECT_BRIEF : captured === 'existing'
      ? { ...EMPTY_BRIEF, projectCount: 1, projectId: 'preview-project', projectTitle: '已有独立项目', suggestions: ['补充第一条可追溯的项目证据', '整理项目目标并建立第一项工作'] }
      : EMPTY_BRIEF;
    return Response.json({ briefing });
  }
  return Response.json({ message: '此入口只在正式 PM-next 中可用。' }, { status: 404 });
};

function App() {
  const initialPath = window.location.pathname;
  const [surface, setSurface] = useState(initialPath.startsWith('/manage') ? 'manage' : 'muse');
  const [mode, setMode] = useState<Scenario>('empty');
  const [draft, setDraft] = useState(new URLSearchParams(window.location.search).get('query') || '');
  const [config, setConfig] = useState(studioModel.controls.config);
  const [railOpen, setRailOpen] = useState(false);
  const [sheet, setSheet] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const opener = useRef<HTMLElement | null>(null);
  const modelReady = mode === 'project' || mode === 'existing';
  const changeMode = (next: Scenario) => { scenario = next; failures = next === 'error' ? 1 : 0; setMode(next); };
  const open = (name: string) => { opener.current = document.activeElement as HTMLElement; setSheet(name); };
  const close = () => { setSheet(null); requestAnimationFrame(() => opener.current?.focus()); };
  const prefill = (text: string) => {
    if (text.trim()) setDraft((current) => current.trim() ? `${current.trim()}\n${text}` : text);
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLTextAreaElement>('.m-dock textarea');
      input?.focus(); if (input) input.setSelectionRange(input.value.length, input.value.length);
    });
  };
  const navigate = (href: string) => {
    const url = new URL(href, PREVIEW_BASE);
    if (url.pathname === '/muse' || url.pathname === '/manage') {
      try { window.history.pushState({}, '', `${url.pathname}${url.search}`); } catch { /* 单文件下载/沙箱预览仍可在内存中切换界面。 */ }
      window.dispatchEvent(new PopStateEvent('popstate'));
      setSurface(url.pathname === '/manage' ? 'manage' : 'muse');
      const query = url.searchParams.get('query'); if (query) setDraft(query);
      return;
    }
    open(url.pathname.startsWith('/settings') ? '运行状态' : url.pathname.startsWith('/knowledge') ? '公司知识' : '项目管理');
  };
  useEffect(() => {
    const listener = (event: Event) => navigate((event as CustomEvent<string>).detail);
    window.addEventListener('preview-navigate', listener);
    return () => window.removeEventListener('preview-navigate', listener);
  });
  useEffect(() => {
    if (!sheet) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    document.querySelector<HTMLButtonElement>('.preview-dialog button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [sheet]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); }, [toast]);

  const overview: React.ComponentProps<typeof WorkbenchClient>['overview'] = mode === 'project' ? {
    ...emptyOverview, portfolio: { productCount: 2, projectCount: 2 },
    productsInFlight: { count: 2, byStage: [], items: [
      { id: 'preview-product-a', title: '轻负担新品', status: 'ANALYSIS', meta: '第一轮验证 · 3 项工作待推进', href: '/products/preview-product-a' },
      { id: 'preview-product-b', title: '渠道试销方案', status: 'RESEARCH', meta: '资料核实 · 等待样品验证', href: '/products/preview-product-b' },
    ] },
    pendingDecisions: { count: 1, items: [{ id: 'preview-decision', title: '确认第一轮样品验证范围', ownerName: '产品负责人', meta: '待负责人审查', status: 'IN_REVIEW', href: '/projects/preview-project?tab=decisions' }] },
    blockers: { count: 1, items: [{ id: 'preview-blocker', title: '补充供应商检测报告', meta: '证据缺口', href: '/projects/preview-project?tab=evidence' }] },
    recentlyCompleted: { count: 1, items: [{ id: 'preview-completed', title: '整理竞品对比资料', meta: '已验收 · 示例记录', href: '/projects/preview-project?tab=tasks' }] },
  } : mode === 'existing' ? { ...emptyOverview, portfolio: { projectCount: 1, productCount: 0 } }
    : mode === 'warning' ? { ...emptyOverview, degraded: true, degradedNote: '部分记录读取失败（预览故障场景），未以零数据代表正常。' } : emptyOverview;
  const activity = mode === 'project' ? { ...emptyActivity, eventCount: 3, triggeredCount: 3, returnReviewCount: 1, attentionCount: 1 } : emptyActivity;

  return <div className="preview-root" onClick={(event) => {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
    if (!anchor || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#')) return;
    const url = new URL(href, PREVIEW_BASE);
    if (!href.startsWith('/') && url.origin !== new URL(PREVIEW_BASE).origin) return;
    event.preventDefault(); navigate(href);
  }}>
    <div className="preview-strip">
      <strong><span>UX</span> PM-next 首屏预览</strong>
      <span className="preview-disclaimer">示例数据 · 不会真实执行</span>
      <div className="preview-switch"><button type="button" data-on={surface === 'muse'} onClick={() => navigate('/muse')}>对话</button><button type="button" data-on={surface === 'manage'} onClick={() => navigate('/manage')}>工作台</button></div>
      <label><span className="preview-scenario-label">场景</span><select aria-label="预览场景" value={mode} onChange={(e) => changeMode(e.target.value as Scenario)}>
        <option value="empty">空工作空间</option><option value="project">有工作与待决策</option><option value="existing">已有项目 / 无记录</option><option value="error">简报失败与重试</option><option value="warning">告警与数据降级</option>
      </select></label>
    </div>
    <div className="preview-frame">
      {surface === 'manage' ? <WorkbenchClient overview={overview} workforceActivity={activity} allUsers={[{ id: 'preview-user', name: '管理员', email: 'preview@example.test' }]} currentSession={{ userId: 'preview-user', userName: '管理员', userEmail: '只读界面预览' }} runtime={{ tone: mode === 'warning' ? 'warn' : 'neutral', label: mode === 'warning' ? '模型尚未就绪' : '运行状态待确认', detail: '预览未连接你的模型、数据库或本机' }} /> :
      <RoleProvider defaultRole="product">
        <div className="muse" data-rail={railOpen ? 'open' : undefined}>
          <Rail user={{ name: '管理员', role: '产品负责人', org: 'Kern Workspace' }} conversations={mode === 'empty' ? [] : studioModel.brief.conversations} activeId={null} runtime={runtime}
            onPick={() => setToast('只读预览：正式项目仍通过真实会话接口切换对话。')} onNew={() => { setDraft(''); setRailOpen(false); }} onTrust={() => open('本机连接')} onClose={() => setRailOpen(false)} onRename={() => open('重命名对话')} onArchive={() => setToast('只读预览：未归档任何真实会话。')} />
          <main className="m-main">
            <header className="m-top"><div className="m-top-in">
              <button type="button" className="m-btn m-rail-open" data-v="ghost" data-size="sm" onClick={() => setRailOpen(true)} aria-label="展开侧栏"><I.menu /></button>
              <nav className="m-seg m-area" aria-label="区域"><a href="/muse" aria-current="page">对话</a><a href="/manage">工作台</a></nav>
              <div className="m-crumb"><h1 className="m-top-title">Kern</h1></div>
              <div className="m-top-acts"><button type="button" className="m-cmdk" aria-label="搜索或跳转（⌘K）" onClick={() => open('搜索与跳转')}><I.search /><span>搜索或跳转</span><kbd>⌘K</kbd></button>
                <Btn size="sm" v="ghost" onClick={() => open('产出')} aria-label="产出"><I.plan /><span>产出</span></Btn>
                <ConversationTools onOpen={(tool: ConversationTool) => open(({ memory: '记忆', vault: '凭证', connectors: '连接', schedules: '定时', trail: '轨迹' })[tool])} />
              </div>
            </div></header>
            {!modelReady ? <div className="m-notice" role="status"><i aria-hidden /><span>模型尚未就绪。可以先整理目标，开始研究前请检查模型与执行服务。</span><a href="/settings#models">查看状态</a></div> : null}
            <div className="m-role-wrap"><KernRoleBar /></div>
            <div className="m-scroll" data-home="true"><div className="m-lane m-conversation-lane">
              <Blank seeds={studioModel.brief.suggestions} attention={studioModel.brief.attention} userName="管理员" modelReady={modelReady} onSeed={prefill} onOpen={() => {}} />
              <DailyBriefing key={mode} onAction={prefill} />
            </div></div>
            <Dock value={draft} onChange={setDraft} draftSaved={false} onSend={() => setToast('只读预览：没有发送消息或执行任务。正式项目保留原有发送与审批接口。')}
              sending={false} controls={{ ...studioModel.controls, models: modelReady ? studioModel.controls.models : [] }} config={config} onConfigChange={setConfig} capabilities={[]} runtimeConnected={false} modelReady={modelReady} onTrust={() => open('本机连接')} />
          </main>
        </div>
      </RoleProvider>}
    </div>
    {sheet ? <><div className="preview-scrim" onClick={close} /><section className="preview-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-dialog-title"><button type="button" aria-label="关闭预览说明" onClick={close}><I.close /></button><span className="preview-dialog-kicker">保留的正式功能入口</span><h2 id="preview-dialog-title">{sheet}</h2><p>首屏预览只展示界面与交互，不连接你的模型、数据库、密钥库或本机。</p><p>这项功能在正式 PM-next 中仍使用原来的真实接口与权限检查；本轮没有改动认证、审批或 Agent 执行链。</p><button type="button" className="preview-dialog-confirm" onClick={close}>返回预览</button></section></> : null}
    {toast ? <div className="preview-toast" role="status">{toast}</div> : null}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
