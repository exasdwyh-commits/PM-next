#!/usr/bin/env python3
"""
把仓库里的真实样式表 (src/app/muse/response/response.css) 与渲染器组装成一个
可离线预览的对话线程页面。这样"预览页"和"产品里跑的代码"共用同一份 CSS，
不会出现 demo 好看、产品里走样的经典问题。

用法: python3 build-conversation.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CSS = (ROOT.parent.parent / "src/app/muse/response/response.css").read_text(encoding="utf8")
PREV = (ROOT / "kern-response.html").read_text(encoding="utf8")

RENDER_JS = "/* ICONS + RENDERER（与 kern-response.html 同源）" + \
    PREV.split("/* ═══════════════════════════════════════════════════════════\n   1. ICONS")[1] \
        .split("/* ═══════════════════════════════════════════════════════════\n   4. 示例信封")[0]
ENV_JS = "/* 示例信封" + \
    PREV.split("/* ═══════════════════════════════════════════════════════════\n   4. 示例信封")[1] \
        .split("/* ═══════════════════════════════════════════════════════════\n   5. BOOT")[0]

SHELL_CSS = """
/* ── 线程外壳（仅预览页需要；产品里由 muse shell 提供）────────── */
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--canvas);color:var(--ink-800);
  font-family:var(--font);font-size:15.5px;line-height:1.78;
  font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
.kc-shell{max-width:1120px;margin:0 auto;padding:28px 22px 120px}
.kc-top{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:13px;flex-wrap:wrap;
  padding:14px 0 16px;margin-bottom:8px;background:linear-gradient(var(--canvas) 72%,transparent)}
.kc-mark{width:32px;height:32px;border-radius:9px;background:linear-gradient(145deg,var(--brand),#7c6cf5);
  display:grid;place-items:center;color:#fff;font-weight:700;font-size:16px;
  box-shadow:0 2px 8px rgba(67,56,202,.3)}
.kc-t{font-size:15px;font-weight:650;color:var(--ink-900);margin:0;letter-spacing:-.01em}
.kc-s{font-size:12px;color:var(--ink-500);margin:0}
.kc-sp{flex:1}
.kc-btn{appearance:none;font:inherit;font-size:13px;font-weight:560;cursor:pointer;
  padding:7px 16px;border-radius:999px;border:1px solid var(--line);background:var(--paper);
  color:var(--ink-700);transition:.15s}
.kc-btn:hover{border-color:var(--brand);color:var(--brand-ink)}
.kc-btn.pri{background:var(--brand);border-color:var(--brand);color:#fff}
.kc-btn:focus-visible{outline:2px solid var(--brand);outline-offset:2px}

/* 用户气泡 */
.kc-turn{margin-bottom:28px}
.kc-user{display:flex;justify-content:flex-end;margin-bottom:22px}
.kc-user span{background:var(--brand);color:#fff;padding:11px 18px;border-radius:18px 18px 4px 18px;
  max-width:min(560px,78%);box-shadow:0 2px 10px rgba(67,56,202,.22);font-size:15px}
/* Kern 署名行 */
.kc-by{display:flex;align-items:center;gap:9px;margin-bottom:11px}
.kc-by .av{width:24px;height:24px;border-radius:7px;background:linear-gradient(145deg,var(--brand),#7c6cf5);
  display:grid;place-items:center;color:#fff;font-size:12px;font-weight:700}
.kc-by .nm{font-weight:640;color:var(--ink-900);font-size:14px}
.kc-by .tm{font-size:12px;color:var(--ink-400)}
.kc-say{margin:0 0 14px;color:var(--ink-700);max-width:var(--measure)}

/* 阶段标记 */
.kc-stage{display:flex;align-items:center;gap:11px;margin:34px 0 20px}
.kc-stage span{font-size:11px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;
  color:var(--ink-400);white-space:nowrap}
.kc-stage::before,.kc-stage::after{content:"";flex:1;height:1px;background:var(--line)}

/* harness 面板 */
.kc-harness{margin-top:30px;background:var(--paper);border:1px solid var(--line);
  border-radius:var(--r-lg);overflow:hidden;box-shadow:var(--shadow-1)}
.kc-hh{display:flex;align-items:center;gap:11px;padding:13px 20px;border-bottom:1px solid var(--line);background:var(--sunk)}
.kc-hh .t{font-size:13.5px;font-weight:660;color:var(--ink-900)}
.kc-hb{padding:4px 20px 16px}
.kc-rule{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;
  padding:9px 0;border-bottom:1px solid var(--line-soft);font-size:13px}
.kc-rule:last-child{border-bottom:0}
.kc-rule .st{width:18px;height:18px;border-radius:6px;display:grid;place-items:center;font-size:11px;font-weight:800}
.kc-rule.pass .st{background:var(--ok-soft);color:var(--ok)}
.kc-rule.fail .st{background:var(--bad-soft);color:var(--bad)}
.kc-rule.warn .st{background:var(--warn-soft);color:var(--warn)}
.kc-rule .id{font-family:var(--mono);font-size:11px;color:var(--ink-400)}
.kc-rule .fx{font-size:12px;color:var(--bad)}
@media print{.kc-top,.kc-harness{display:none}}
"""

HTML = f"""<!DOCTYPE html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kern · 对话呈现框架 v1</title>
<style>
{CSS}
{SHELL_CSS}
</style>
</head>
<body>
<div class="kc-shell">
  <header class="kc-top">
    <div class="kc-mark">K</div>
    <div>
      <p class="kc-t">Kern 对话呈现框架</p>
      <p class="kc-s">澄清 → 实时进度 → 结论 · 与产品共用 response.css</p>
    </div>
    <div class="kc-sp"></div>
    <button class="kc-btn" id="replay" type="button">重播流式过程</button>
    <div class="kr-seg" role="group" aria-label="信息密度" style="display:inline-flex">
      <button type="button" data-d="summary" aria-pressed="true">摘要</button>
      <button type="button" data-d="full" aria-pressed="false">完整</button>
    </div>
  </header>

  <main id="thread"></main>
  <section id="harness"></section>
</div>

<script>
{RENDER_JS}
{ENV_JS}

/* ═══════════════════════════════════════════════════════════
   对话线程：三个阶段共用同一套 Block 渲染器
   ═══════════════════════════════════════════════════════════ */

const STEPS = [
  {{ key:"market",     label:"市场与竞品研究", agent:"市场研究",  text:"锁定 25–35 岁控糖白领；头部 3 家占线上 52% 份额，价格带 ¥8–15。" }},
  {{ key:"compliance", label:"合规边界",       agent:"合规",      text:"「无糖」需糖 ≤ 0.5g/100g（GB 28050）；「高蛋白」需 ≥ 12g/100g。" }},
  {{ key:"economics",  label:"单位经济性",     agent:"成本",      text:"目标零售价 ¥12，BOM 假设 ¥4.1，目标毛利 55%。BOM 待询价。" }},
  {{ key:"opportunity",label:"机会判断与方向", agent:"产品",      text:"推荐高蛋白海苔脆：同价位蛋白含量领先约 40%。" }},
  {{ key:"validation", label:"验证计划",       agent:"市场研究",  text:"三条最小验证：盲测 n=60、小红书种草、小批试产，合计 ¥58k。" }},
  {{ key:"gtm",        label:"上市与营销策略", agent:"营销",      text:"小红书种草 → 抖音直播 → 天猫旗舰店，首月目标 5,000 单。" }},
  {{ key:"red-team",   label:"红队挑战",       agent:"红队",      text:"头部 3 个月内跟进概率高；原料季节波动 ±25%；口感可能失败。" }},
  {{ key:"qa",         label:"独立 QA 复核",   agent:"QA",        text:"第 1 轮打回：缺竞品对照。修订后通过。" }},
  {{ key:"synthesis",  label:"Kern 综合结论",  agent:"Kern",      text:"推荐做高蛋白海苔脆，需你拍板 ¥58k 验证预算。" }},
];

const briefEnvelope = {{
  v:1, kind:"BRIEF", demo:true, confidence:"MEDIUM",
  lede:"这件事我来牵头，开工前先确认三件事",
  blocks:[{{ type:"clarify", questions:[
    {{ id:"who", ask:"主要卖给谁？", why:"决定市场研究和机会判断看哪群人",
      options:["城市年轻白领","家庭 / 宝妈","中小企业（B2B）","还没想好，让团队研究"] }},
    {{ id:"budget", ask:"首轮验证的预算大概多少？", why:"决定验证计划的规模和成本假设",
      options:["10 万以内，快速验证","10–50 万","50 万以上","先不设限"],
      remembered:"预算上限 5 万" }},
    {{ id:"channel", ask:"优先走什么渠道？", why:"决定上市策略和竞品范围",
      options:["线上电商 / 内容平台","线下零售","企业客户直销","让团队建议"],
      remembered:"只做跨境电商" }},
  ]}}],
  meta:{{ model:"kern-demo（示例数据）", elapsedMs:1240, steps:3, quota:null, memoriesUsed:["只做跨境电商","预算上限 5 万"], sources:0 }},
}};

const progressEnvelope = (done, steps) => ({{
  v:1, kind:"PROGRESS", demo:true, confidence:"MEDIUM",
  lede:done >= steps.length ? "九个步骤都跑完了，正在汇总" : `团队正在推进：${{steps[Math.min(done,steps.length-1)].label}}`,
  blocks:[{{ type:"progress", done, total:steps.length, steps }}],
  meta:{{ model:"kern-demo（示例数据）", elapsedMs:done*4800, steps:9, quota:null, memoriesUsed:["只做跨境电商","预算上限 5 万"], sources:0 }},
}});

/* ── 渲染线程 ─────────────────────────────────────────────── */
const thread = document.getElementById("thread");

function turn(userText, kernSay, mountId, stage) {{
  return `
    ${{stage ? `<div class="kc-stage"><span>${{stage}}</span></div>` : ""}}
    <div class="kc-turn">
      ${{userText ? `<div class="kc-user"><span>${{userText}}</span></div>` : ""}}
      <div class="kc-by"><span class="av">K</span><span class="nm">Kern</span><span class="tm">18:29</span></div>
      ${{kernSay ? `<p class="kc-say">${{kernSay}}</p>` : ""}}
      <div id="${{mountId}}"></div>
    </div>`;
}}

thread.innerHTML =
  turn("我想开发一个新产品：面向控糖白领的高蛋白零食",
       "这件事我来牵头。开工前先确认几件事，这样团队不会跑偏：", "m-brief", "第一步 · 先确认再开工")
+ turn(null, "收到。九位成员已经开工，我会在有结论或需要你拍板时回来。", "m-progress", "第二步 · 干活过程")
+ turn(null, null, "m-conclusion", "第三步 · 结论与拍板");

render(briefEnvelope, document.getElementById("m-brief"));
render(ENVELOPE, document.getElementById("m-conclusion"));

/* ── 流式回放 ─────────────────────────────────────────────── */
const mp = document.getElementById("m-progress");
let timer = null;

function replay() {{
  if (timer) clearInterval(timer);
  const live = STEPS.map((s) => ({{ ...s, state:"queued", delta:"" }}));
  let i = 0, ch = 0;
  const paint = () => render(progressEnvelope(live.filter((s) => s.state === "done").length, live), mp);
  paint();
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {{
    live.forEach((s) => {{ s.state = "done"; s.delta = s.text; s.elapsedMs = 4800; }});
    paint(); return;
  }}
  timer = setInterval(() => {{
    if (i >= live.length) {{ clearInterval(timer); timer = null; return; }}
    const s = live[i];
    if (s.state === "queued") s.state = "running";
    ch += 3;
    s.delta = s.text.slice(0, ch);
    if (ch >= s.text.length) {{ s.state = "done"; s.elapsedMs = 3200 + i * 400; i += 1; ch = 0; }}
    paint();
  }}, 42);
}}
replay();
document.getElementById("replay").addEventListener("click", replay);

/* ── 密度切换（对整条线程生效）──────────────────────────── */
document.querySelectorAll(".kc-top .kr-seg button").forEach((b) =>
  b.addEventListener("click", () => {{
    document.querySelectorAll(".kc-top .kr-seg button").forEach((x) =>
      x.setAttribute("aria-pressed", String(x === b)));
    thread.dataset.density = b.dataset.d;
  }}));
// 密度挂在线程容器上：流式重绘不会丢状态（CSS 用祖先选择器生效）
thread.dataset.density = "summary";

/* ── harness：对三个信封分别跑规则 ──────────────────────── */
const H = document.getElementById("harness");
function panel(name, env) {{
  const rs = validate(env);
  const errs = rs.filter((r) => !r.ok && r.level === "error").length;
  const warns = rs.filter((r) => !r.ok && r.level === "warn").length;
  return `
    <div class="kc-harness">
      <div class="kc-hh"><span class="t">harness · ${{name}}</span>
        <span class="kr-badge ${{errs ? "bad" : "ok"}}">${{errs ? errs + " 项阻断" : "全部通过"}}</span>
        ${{warns ? `<span class="kr-badge warn">${{warns}} 项提醒</span>` : ""}}
        <span style="flex:1"></span>
        <span style="font-size:12px;color:var(--ink-400)">KERN_RESPONSE_SPEC.md §4</span></div>
      <div class="kc-hb">${{rs.map((r) => `
        <div class="kc-rule ${{r.ok ? "pass" : r.level === "error" ? "fail" : "warn"}}">
          <span class="st">${{r.ok ? "✓" : r.level === "error" ? "✕" : "!"}}</span>
          <span><span class="id">${{r.id}}</span> ${{r.desc}}</span>
          <span class="fx">${{r.detail || ""}}</span></div>`).join("")}}</div>
    </div>`;
}}
H.innerHTML = panel("BRIEF 澄清卡", briefEnvelope) + panel("CONCLUSION 结论卡", ENVELOPE);

window.Kern = {{ render, validate, RULES, ENVELOPE, briefEnvelope, progressEnvelope }};
</script>
</body>
</html>
"""

out = ROOT / "kern-conversation.html"
out.write_text(HTML, encoding="utf8")
print(f"wrote {out} ({len(HTML)} chars)")
