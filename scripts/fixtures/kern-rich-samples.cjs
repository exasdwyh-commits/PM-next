/**
 * FIXED SAMPLES — not model output.
 *
 * Deterministic replies used by scripts/mock-kern-rich-llm.cjs to exercise the real
 * /muse pipeline (message → worker → gateway → normalize → persist → render) when no
 * real model credentials are available. Every number in these samples comes from the
 * user message that triggers it (or is derived from those numbers and labelled so);
 * nothing is invented. Verification reports must call these "固定样例", never
 * "真实模型生成".
 */

const PROMPTS = {
  compare: "对比两个协作工具套餐：方案 A 月费 299 元，含 5 个席位，数据保留 90 天，支持 SSO；方案 B 月费 199 元，含 3 个席位，每加 1 个席位 49 元，数据保留 30 天，不支持 SSO。我们团队 6 个人，做成可交互的对比。",
  compareEdit: "把对比里加一行「数据导出」：A 支持 CSV 导出，B 不支持；并突出风险。",
  cost: "按这些数据算单杯拿铁成本并做成可视化：咖啡豆每杯 18 克、每公斤 160 元；牛奶每杯 200 毫升、每升 16 元；杯子杯盖吸管每套 0.6 元；人工按每杯 2.5 元；售价 22 元。",
  plan: "官网改版排期做成可视化：调研 10/12–10/18 已完成；设计 10/19–11/01 进行中，依赖调研；开发 11/02–11/22 未开始，依赖设计；测试 11/23–11/29 依赖开发；发布 11/30 依赖测试。目前设计卡在品牌素材还没到。",
  short: "SSO 是什么意思？",
  // V2 /muse 验收（产品方案比较 → 同一成果连续修改）。数字全部写在提示词里，样例只做搬运和由此推出的计算。
  productCompare: "帮我比较两个产品方案并做成可交互的对比视图：方案 A 自建 SaaS 订阅，每席位每月 99 元，预计 3 个月上线；方案 B 给大客户做私有化部署，单客户报价 18 万元，交付周期 4 个月。备选方案 C：通过渠道代理分销，返佣 30%，1 个月可启动。我们团队 6 个人，希望半年内有稳定收入。",
  productCompareEdit: "突出风险，把第二个方案换掉。",
};

const fence = (obj) => "```kern-ui\n" + JSON.stringify(obj) + "\n```";

const baseCss = `
:root{color-scheme:light dark;--bg:#fbfaff;--card:#fff;--ink:#201831;--ink2:#5b4f6b;--ink3:#8a7f99;--line:#e7e0f0;--brand:#7c3aed;--brand2:#c0269b;--soft:#f1e9ff;--ok:#15803d;--okbg:#e8f7ee;--warn:#b45309;--warnbg:#fef5e7;--bad:#dc2626;--badbg:#fef0f0}
@media (prefers-color-scheme:dark){:root{--bg:#15111f;--card:#211b2f;--ink:#f4effa;--ink2:#cfc3de;--ink3:#9d8db0;--line:#3c304e;--brand:#a78bfa;--brand2:#f0abdf;--soft:#352349;--ok:#4ade80;--okbg:#14301f;--warn:#fbbf24;--warnbg:#3a2a10;--bad:#f87171;--badbg:#3b1a1a}}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif;padding:22px}
h1{font-size:22px;margin:0 0 4px;letter-spacing:-.02em}.sub{color:var(--ink3);font-size:13px;margin:0 0 18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px;box-shadow:0 10px 30px -22px rgba(56,34,90,.4)}
.tag{display:inline-block;padding:1px 7px;border-radius:6px;font-size:11.5px;font-weight:600}
.fact{background:var(--okbg);color:var(--ok)}.infer{background:var(--soft);color:var(--brand)}.assume{background:var(--warnbg);color:var(--warn)}.unknown{box-shadow:inset 0 0 0 1px var(--line);color:var(--ink3)}
button{font:inherit;cursor:pointer}
.seg{display:inline-flex;padding:3px;border-radius:12px;background:var(--soft);gap:2px}.seg button{border:0;background:transparent;color:var(--ink2);padding:7px 14px;border-radius:9px;min-height:36px}.seg button[aria-pressed=true]{background:var(--card);color:var(--ink);font-weight:650;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.src{margin-top:18px;color:var(--ink3);font-size:12.5px}.src li{margin:2px 0}
.ask{margin-top:14px;border:1px solid var(--line);background:var(--card);color:var(--brand);border-radius:10px;padding:8px 14px;min-height:40px}
@media (max-width:520px){body{padding:14px}h1{font-size:19px}}
`;

function compareHtml(withExport) {
  const rows = [
    ["月费", "299 元", "199 元", "用户提供", "fact"],
    ["包含席位", "5 个", "3 个", "用户提供", "fact"],
    ["6 人总月费", "未知：第 6 个席位价格没给", "199 + 3×49 = 346 元", "由用户数字计算", "infer"],
    ["数据保留", "90 天", "30 天", "用户提供", "fact"],
    ["SSO", "支持", "不支持", "用户提供", "fact"],
  ];
  if (withExport) rows.push(["数据导出", "支持 CSV", "不支持", "用户提供", "fact"]);
  const tr = rows.map(r => `<tr data-k="${r[0]}"><th>${r[0]}</th><td>${r[1]}</td><td>${r[2]}</td><td><span class="tag ${r[4]}">${r[4] === "fact" ? "事实" : "推断"}</span> ${r[3]}</td></tr>`).join("");
  const risk = withExport
    ? `<div class="card risk"><b>风险（已突出）</b><ul><li><b>方案 B 不能导出数据</b>：30 天保留期到期后历史记录无法自行备份。<span class="tag infer">推断</span></li><li><b>方案 A 的 6 人成本未知</b>：需向供应商确认第 6 个席位价格。<span class="tag unknown">未知</span></li><li>B 不支持 SSO：离职回收账号要手工处理。<span class="tag infer">推断</span></li></ul></div>`
    : `<div class="card risk"><b>风险</b><ul><li>方案 A 的 6 人成本未知：需确认第 6 个席位价格。<span class="tag unknown">未知</span></li><li>B 不支持 SSO：离职回收账号要手工处理。<span class="tag infer">推断</span></li></ul></div>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>协作工具套餐对比</title><style>${baseCss}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:14px}
.opt{position:relative}.opt h2{margin:0 0 4px;font-size:17px}.price{font-size:30px;font-weight:760;letter-spacing:-.03em;font-variant-numeric:tabular-nums}.price small{font-size:13px;color:var(--ink3);font-weight:500}
.opt[data-on=true]{border-color:var(--brand);box-shadow:0 0 0 3px var(--soft)}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}thead th{font-size:12px;color:var(--ink3);background:var(--soft)}tbody th{color:var(--ink2);font-weight:560;white-space:nowrap}
td.hl{background:var(--soft)}tr:last-child>*{border-bottom:0}.wrap{overflow-x:auto;border:1px solid var(--line);border-radius:14px;margin-bottom:14px}
.risk ul{margin:8px 0 0;padding-left:18px}.risk li{margin:4px 0}.risk{border-color:${withExport ? "var(--bad)" : "var(--line)"};${withExport ? "background:var(--badbg);" : ""}}
@media (max-width:520px){.grid{grid-template-columns:1fr}}
</style></head><body>
<h1>协作工具套餐对比（6 人团队）</h1><p class="sub">数字全部来自你的消息；6 人总价中 A 的部分缺数据，未做估算。</p>
<div class="seg" role="group" aria-label="突出方案"><button aria-pressed="false" data-pick="a">突出 A</button><button aria-pressed="false" data-pick="b">突出 B</button><button aria-pressed="true" data-pick="">不突出</button></div>
<div class="grid" style="margin-top:14px">
<div class="card opt" data-opt="a"><h2>方案 A</h2><div class="price">299<small> 元/月 · 含 5 席</small></div><p>保留 90 天 · 支持 SSO</p></div>
<div class="card opt" data-opt="b"><h2>方案 B</h2><div class="price">346<small> 元/月 · 6 人（计算）</small></div><p>保留 30 天 · 不支持 SSO</p></div>
</div>
<div class="wrap"><table><thead><tr><th>维度</th><th>方案 A</th><th>方案 B</th><th>依据</th></tr></thead><tbody>${tr}</tbody></table></div>
${risk}
<button class="ask" type="button" onclick="window.kern&&window.kern.ask('请帮我列出向方案 A 供应商确认第 6 个席位价格的问题清单')">让 Kern 列出要问供应商的问题</button>
<ol class="src"><li>[1] 用户消息：两套餐的月费、席位、保留期、SSO${withExport ? "、导出能力" : ""}与团队人数。</li></ol>
<script>
var btns=document.querySelectorAll('[data-pick]');btns.forEach(function(b){b.addEventListener('click',function(){var k=b.getAttribute('data-pick');btns.forEach(function(x){x.setAttribute('aria-pressed',String(x===b))});document.querySelectorAll('.opt').forEach(function(o){o.setAttribute('data-on',String(o.getAttribute('data-opt')===k))});document.querySelectorAll('tbody tr').forEach(function(tr){tr.children[1].classList.toggle('hl',k==='a');tr.children[2].classList.toggle('hl',k==='b')})})});
</script></body></html>`;
}

const costItems = [
  { label: "咖啡豆", value: 2.88, calc: "18 克 × 160 元/公斤" },
  { label: "牛奶", value: 3.2, calc: "200 毫升 × 16 元/升" },
  { label: "杯子杯盖吸管", value: 0.6, calc: "每套 0.6 元" },
  { label: "人工", value: 2.5, calc: "每杯 2.5 元" },
];

function costHtml() {
  const data = JSON.stringify(costItems);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>单杯拿铁成本</title><style>${baseCss}
.kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 14px}.kpi b{display:block;font-size:30px;letter-spacing:-.03em;font-variant-numeric:tabular-nums}.kpi span{color:var(--ink3);font-size:13px}
.row{display:grid;grid-template-columns:110px minmax(0,1fr) 72px;gap:12px;align-items:center;margin:10px 0;font-size:14px}.bar{height:12px;border-radius:99px;background:var(--soft);overflow:hidden}.bar i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--brand),var(--brand2));transition:width .4s}
.row small{grid-column:2/4;color:var(--ink3);margin-top:-8px}.val{text-align:right;font-variant-numeric:tabular-nums;font-weight:650}
label{display:flex;gap:10px;align-items:center;font-size:14px;margin-top:14px;flex-wrap:wrap}input[type=range]{flex:1;min-width:160px;accent-color:var(--brand)}
@media (max-width:520px){.kpis{grid-template-columns:1fr 1fr}.row{grid-template-columns:84px minmax(0,1fr) 60px}}
</style></head><body>
<h1>单杯拿铁成本拆解</h1><p class="sub">全部单价来自你的消息；成本与毛利由这些数字计算。拖动滑块只是情景试算，<b>不是</b>新数据。</p>
<div class="kpis"><div class="card kpi"><span>单杯成本</span><b id="total">—</b><span class="tag infer">计算</span></div><div class="card kpi"><span>售价</span><b id="price">22.00</b><span class="tag fact">用户提供</span></div><div class="card kpi"><span>毛利率</span><b id="margin">—</b><span class="tag infer">计算</span></div></div>
<div class="card"><div id="rows"></div>
<label>情景：牛奶单价 <input id="milk" type="range" min="10" max="24" step="0.5" value="16"><output id="milkv">16.0 元/升</output></label>
<p class="sub" id="note" style="margin:6px 0 0">当前为你给的原始数据。</p></div>
<button class="ask" type="button" onclick="window.kern&&window.kern.ask('按当前滑块的牛奶单价，帮我重新评估定价')">把这个情景交给 Kern</button>
<ol class="src"><li>[1] 用户消息：豆量与豆价、奶量与奶价、包材、人工、售价。</li></ol>
<script>
var items=${data};var price=22;
function fmt(n){return n.toFixed(2)}
function render(){var milk=parseFloat(document.getElementById('milk').value);var list=items.map(function(i){return i.label==='牛奶'?{label:i.label,value:0.2*milk,calc:'200 毫升 × '+milk.toFixed(1)+' 元/升'}:i});var total=list.reduce(function(a,b){return a+b.value},0);var max=Math.max.apply(null,list.map(function(i){return i.value}));
document.getElementById('rows').innerHTML=list.map(function(i){return '<div class="row"><span>'+i.label+'</span><span class="bar"><i style="width:'+(i.value/max*100)+'%"></i></span><span class="val">'+fmt(i.value)+'</span><small>'+i.calc+'</small></div>'}).join('');
document.getElementById('total').textContent=fmt(total);document.getElementById('margin').textContent=((price-total)/price*100).toFixed(1)+'%';document.getElementById('milkv').textContent=milk.toFixed(1)+' 元/升';document.getElementById('note').textContent=milk===16?'当前为你给的原始数据。':'情景试算：牛奶单价改为 '+milk.toFixed(1)+' 元/升（假设）。'}
document.getElementById('milk').addEventListener('input',render);render();
</script></body></html>`;
}

const phases = [
  { phase: "调研", when: "10/12–10/18", status: "done", depends: [] },
  { phase: "设计", when: "10/19–11/01", status: "blocked", depends: ["调研"], note: "品牌素材未到" },
  { phase: "开发", when: "11/02–11/22", status: "todo", depends: ["设计"] },
  { phase: "测试", when: "11/23–11/29", status: "todo", depends: ["开发"] },
  { phase: "发布", when: "11/30", status: "todo", depends: ["测试"] },
];

function planHtml() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>官网改版排期</title><style>${baseCss}
.gantt{position:relative;margin-top:14px}.scale{display:grid;grid-template-columns:repeat(8,1fr);margin-left:92px;color:var(--ink3);font-size:11.5px;border-bottom:1px solid var(--line);padding-bottom:4px}
.g{display:grid;grid-template-columns:80px minmax(0,1fr);gap:12px;align-items:center;margin:12px 0}.g button{all:unset;cursor:pointer;display:block;width:100%;height:30px;border-radius:9px;position:relative}
.track{position:relative;height:30px}.blk{position:absolute;top:0;bottom:0;border-radius:9px;display:flex;align-items:center;padding:0 10px;font-size:12px;color:#fff;white-space:nowrap;overflow:hidden}
.done{background:var(--ok)}.blocked{background:var(--bad)}.todo{background:var(--line);color:var(--ink2)}.active{background:linear-gradient(90deg,var(--brand),var(--brand2))}
.g[data-sel=true] .blk{outline:3px solid var(--soft);outline-offset:2px}
.detail{margin-top:12px}.legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12.5px;color:var(--ink3);margin-top:10px}.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.filter{margin-top:6px}
@media (max-width:520px){.scale{margin-left:72px}.g{grid-template-columns:60px minmax(0,1fr)}}
</style></head><body>
<h1>官网改版排期</h1><p class="sub">日期、依赖与状态来自你的消息；“设计”因品牌素材未到标为受阻。</p>
<div class="seg filter" role="group" aria-label="筛选"><button aria-pressed="true" data-f="all">全部</button><button aria-pressed="false" data-f="open">未完成</button><button aria-pressed="false" data-f="blocked">受阻</button></div>
<div class="card gantt"><div class="scale"><span>10/12</span><span>10/19</span><span>10/26</span><span>11/02</span><span>11/09</span><span>11/16</span><span>11/23</span><span>11/30</span></div><div id="rows"></div>
<div class="legend"><span><i class="done"></i>已完成</span><span><i class="blocked"></i>受阻</span><span><i class="todo"></i>未开始</span></div></div>
<div class="card detail" id="detail" aria-live="polite">点一个阶段查看依赖。</div>
<button class="ask" type="button" onclick="window.kern&&window.kern.ask('品牌素材如果再晚一周到，排期要怎么调整？')">问 Kern：素材再晚一周怎么办</button>
<ol class="src"><li>[1] 用户消息：五个阶段的日期、依赖、状态与受阻原因。</li></ol>
<script>
var P=${JSON.stringify(phases)};var start=new Date(2026,9,12).getTime(),end=new Date(2026,11,7).getTime(),day=864e5;
function range(w){var p=w.split('–');function d(s){var a=s.split('/');return new Date(2026,+a[0]-1,+a[1]).getTime()}var s=d(p[0]),e=p[1]?d(p[1])+day:d(p[0])+day;return[s,e]}
var LBL={done:'已完成',blocked:'受阻',todo:'未开始',active:'进行中'};var f='all';
function render(){document.getElementById('rows').innerHTML=P.map(function(p,i){if(f==='open'&&p.status==='done')return'';if(f==='blocked'&&p.status!=='blocked')return'';var r=range(p.when),l=(r[0]-start)/(end-start)*100,w=(r[1]-r[0])/(end-start)*100;return '<div class="g" data-i="'+i+'"><span>'+p.phase+'</span><div class="track"><button aria-label="'+p.phase+' '+p.when+' '+LBL[p.status]+'"><span class="blk '+p.status+'" style="left:'+l+'%;width:'+Math.max(w,3)+'%">'+p.when+'</span></button></div></div>'}).join('');
document.querySelectorAll('.g').forEach(function(g){g.querySelector('button').addEventListener('click',function(){document.querySelectorAll('.g').forEach(function(x){x.setAttribute('data-sel',String(x===g))});var p=P[+g.getAttribute('data-i')];document.getElementById('detail').innerHTML='<b>'+p.phase+'</b> · '+p.when+' · '+LBL[p.status]+(p.depends.length?'<br>依赖：'+p.depends.join('、'):'')+(p.note?'<br><span class="tag unknown">阻塞</span> '+p.note:'')})})}
document.querySelectorAll('[data-f]').forEach(function(b){b.addEventListener('click',function(){f=b.getAttribute('data-f');document.querySelectorAll('[data-f]').forEach(function(x){x.setAttribute('aria-pressed',String(x===b))});render()})});render();
</script></body></html>`;
}


// ───────── V2 acceptance: product plan comparison (plan-compare v1 → v2) ─────────
function productCompareHtml(edit) {
  const second = edit
    ? { id: "c", name: "方案 C · 渠道代理分销", price: "返佣 30%", sub: "1 个月可启动", note: "你提到的备选方案" }
    : { id: "b", name: "方案 B · 大客户私有化部署", price: "18 万元/客户", sub: "交付周期 4 个月", note: "" };
  const rows = edit
    ? [
        ["定价", "99 元/席位/月", "按 A 的定价分销，每席位到手 99 × 70% = 69.3 元/月", "A 用户提供；C 由用户数字计算", "infer"],
        ["启动时间", "3 个月上线", "1 个月可启动", "用户提供", "fact"],
        ["收入确定性", "取决于付费席位数（未知）", "取决于代理商出单量（未知）", "缺数据，未估算", "unknown"],
        ["团队占用", "6 人自建产品", "需先有可售卖的产品（依赖 A）", "推断", "infer"],
      ]
    : [
        ["定价", "99 元/席位/月", "18 万元/客户", "用户提供", "fact"],
        ["上线 / 交付", "3 个月上线", "交付周期 4 个月", "用户提供", "fact"],
        ["收入确定性", "取决于付费席位数（未知）", "取决于能否签下大客户（未知）", "缺数据，未估算", "unknown"],
        ["团队占用", "6 人自建产品", "交付期间大部分人力被单个客户占用", "推断", "infer"],
      ];
  const label = { fact: "事实", infer: "推断", unknown: "未知" };
  const tr = rows.map(r => `<tr><th>${r[0]}</th><td>${r[1]}</td><td>${r[2]}</td><td><span class="tag ${r[4]}">${label[r[4]]}</span> ${r[3]}</td></tr>`).join("");
  const risks = edit
    ? [
        ["high", "C 的 30% 返佣直接压缩毛利：每席位到手从 99 元降到 69.3 元", "infer", "只把 C 当补充渠道，主线仍走 A 的直销"],
        ["high", "C 依赖 A 先有可卖的产品：A 延期，C 也无法启动", "infer", "A 先做最小可售版本，再招代理"],
        ["medium", "A 的付费席位数没有预期数据，半年收入无法估算", "unknown", "先做 20 个目标客户访谈，拿到意向数据"],
        ["medium", "代理商出单量未知，C 的收入不可预测", "unknown", "签约前约定最低出单量或试运营期"],
      ]
    : [
        ["medium", "A 的付费席位数没有预期数据，半年收入无法估算", "unknown", "先做目标客户访谈"],
        ["medium", "B 交付 4 个月，期间团队被单个客户占用", "infer", "合同按里程碑分期回款"],
      ];
  const riskHtml = risks.map(r => `<li data-impact="${r[0]}"><span class="imp">${r[0] === "high" ? "高" : "中"}</span><div><b>${r[1]}</b><small><span class="tag ${r[2]}">${label[r[2]]}</span> 缓解：${r[3]}</small></div></li>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>产品方案对比</title><style>${baseCss}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:14px 0}
.opt h2{margin:0 0 4px;font-size:16px}.price{font-size:26px;font-weight:760;letter-spacing:-.02em;font-variant-numeric:tabular-nums}.price small{display:block;font-size:13px;color:var(--ink3);font-weight:500}
.opt[data-on=true]{border-color:var(--brand);box-shadow:0 0 0 3px var(--soft)}.badge{display:inline-block;margin-top:6px;font-size:12px;color:var(--brand)}
.wrap{overflow-x:auto;border:1px solid var(--line);border-radius:14px;margin-bottom:14px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}thead th{font-size:12px;color:var(--ink3);background:var(--soft)}tbody th{color:var(--ink2);font-weight:560;white-space:nowrap}tr:last-child>*{border-bottom:0}
.risk{${edit ? "border-color:var(--bad);background:var(--badbg);" : ""}}.risk h3{margin:0 0 8px;font-size:15px}.risk ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}.risk li{display:flex;gap:10px;align-items:flex-start}.risk small{display:block;color:var(--ink2);margin-top:2px}
.imp{flex:none;min-width:24px;padding:1px 6px;border-radius:6px;font-size:12px;font-weight:700;text-align:center;background:var(--warnbg);color:var(--warn)}li[data-impact=high] .imp{background:var(--bad);color:#fff}
@media (max-width:520px){.grid{grid-template-columns:1fr}}
</style></head><body>
<h1>产品方案对比：A 自建 SaaS vs ${edit ? "C 渠道代理分销" : "B 私有化部署"}</h1><p class="sub">${edit ? "第二个方案已换成你提到的备选方案 C，风险已突出。" : ""}数字全部来自你的消息；收入没有预期数据，未做估算。</p>
${edit ? `<div class="card risk" id="risks"><h3>风险（已突出）</h3><ul>${riskHtml}</ul></div>` : ""}
<div class="seg" role="group" aria-label="突出方案"><button aria-pressed="false" data-pick="a">突出 A</button><button aria-pressed="false" data-pick="${second.id}">突出 ${second.id.toUpperCase()}</button><button aria-pressed="true" data-pick="">不突出</button></div>
<div class="grid">
<div class="card opt" data-opt="a"><h2>方案 A · 自建 SaaS 订阅</h2><div class="price">99 元<small>每席位每月 · 预计 3 个月上线</small></div><span class="badge">主线建议</span></div>
<div class="card opt" data-opt="${second.id}"><h2>${second.name}</h2><div class="price">${second.price}<small>${second.sub}</small></div>${second.note ? `<span class="badge">${second.note}</span>` : ""}</div>
</div>
<div class="wrap"><table><thead><tr><th>维度</th><th>方案 A</th><th>${edit ? "方案 C" : "方案 B"}</th><th>依据</th></tr></thead><tbody>${tr}</tbody></table></div>
${edit ? "" : `<div class="card risk"><h3>风险</h3><ul>${riskHtml}</ul></div>`}
<ol class="src"><li>[1] 你在本轮对话中提供的定价、周期、返佣与团队人数（用户提供）</li></ol>
<button class="ask" type="button" onclick="window.kern&&window.kern.ask('${edit ? "帮我列出招募渠道代理前要准备的材料" : "突出风险，把第二个方案换掉。"}')">${edit ? "继续：代理招募准备" : "继续：突出风险并替换第二个方案"}</button>
<script>
var btns=document.querySelectorAll('[data-pick]');btns.forEach(function(b){b.addEventListener('click',function(){var k=b.getAttribute('data-pick');btns.forEach(function(x){x.setAttribute('aria-pressed',String(x===b))});document.querySelectorAll('.opt').forEach(function(o){o.setAttribute('data-on',String(o.getAttribute('data-opt')===k))})})});
</script></body></html>`;
}

function productCompareReply(edit, opts = {}) {
  const fence2 = (o) => "```kern-ui\n" + JSON.stringify(o) + "\n```";
  const lead = edit
    ? "已把第二个方案换成你提到的备选方案 C（渠道代理分销），并把风险单独突出。**结论调整：A 仍是主线；C 启动最快（1 个月），适合作为补充渠道，但 30% 返佣会把每席位到手价从 99 元压到 69.3 元。**"
    : "**结论：以“半年内有稳定收入”为目标，方案 A（自建 SaaS 订阅）更稳妥，但收入取决于付费席位数——你没给获客预期，我没有估算收入。** 方案 B 单客户 18 万元，但交付 4 个月，而且前提是先签下大客户。";
  const second = edit
    ? { name: "方案 C · 渠道代理", tagline: "返佣 30% · 1 个月可启动", pros: ["启动最快（1 个月）", "不占用研发人力去获客"], cons: ["每席位到手 69.3 元（99 × 70%）", "依赖 A 先有可卖的产品", "代理出单量未知"] }
    : { name: "方案 B · 私有化部署", tagline: "18 万元/客户 · 交付 4 个月", pros: ["单笔金额高"], cons: ["交付 4 个月，团队被单客户占用", "能否签下大客户未知"] };
  return [
    lead,
    "",
    fence2({ type: "compare", title: edit ? "A vs C" : "A vs B", options: [
      { name: "方案 A · 自建 SaaS", tagline: "99 元/席位/月 · 3 个月上线", pick: true, pros: ["按月持续收入", "上线比 B 快"], cons: ["收入取决于付费席位数（未知）"] },
      second,
    ], criteria: edit ? [
      { label: "定价", values: ["99 元/席位/月", "到手 69.3 元/席位/月（推断）"] },
      { label: "启动", values: ["3 个月上线", "1 个月可启动"] },
      { label: "收入确定性", values: ["未知", "未知"] },
    ] : [
      { label: "定价", values: ["99 元/席位/月", "18 万元/客户"] },
      { label: "上线 / 交付", values: ["3 个月", "4 个月"] },
      { label: "收入确定性", values: ["未知", "未知"] },
    ] }),
    "",
    edit ? fence2({ type: "risks", title: "风险（已突出）", items: [
      { risk: "30% 返佣压缩毛利：每席位到手从 99 元降到 69.3 元", impact: "high", mitigation: "C 只做补充渠道，主线走 A 的直销", basis: "inference" },
      { risk: "C 依赖 A 先有可卖的产品，A 延期则 C 无法启动", impact: "high", mitigation: "A 先做最小可售版本，再招代理", basis: "inference" },
      { risk: "A 的付费席位数没有预期数据，半年收入无法估算", impact: "medium", mitigation: "先做目标客户访谈拿意向数据", basis: "unknown" },
    ] }) : fence2({ type: "unknown", title: "还缺的信息", items: [
      { question: "方案 A 预计半年内能拿到多少付费席位？", needs: "目标客户访谈或已有意向名单" },
      { question: "方案 B 是否已有意向大客户？", needs: "销售线索或意向书" },
    ] }),
    "",
    "下面是可交互的对比视图（可切换突出某个方案）：",
    "",
    `<kern-artifact key="plan-compare" title="产品方案对比" kind="compare">`,
    opts.truncate ? productCompareHtml(edit).slice(0, 900) : productCompareHtml(edit),
    ...(opts.truncate ? [] : ["</kern-artifact>"]),
    ...(opts.truncate ? [] : [
      "",
      fence2({ type: "sources", items: [{ n: 1, title: "你在本轮对话中提供的定价、周期、返佣与团队人数", trust: "user" }] }),
      "",
      fence2({ type: "next", items: edit
        ? [{ label: "代理招募准备", prompt: "帮我列出招募渠道代理前要准备的材料" }]
        : [{ label: "突出风险并替换第二个方案", prompt: PROMPTS.productCompareEdit }] }),
    ]),
  ].join("\n");
}

function reply(kind) {
  if (kind === "short") {
    return "**SSO（单点登录）** 指用一套公司账号登录多个系统：员工只登录一次，就能进入所有接入的工具；离职时管理员在一个地方停用账号，所有工具的访问同时收回。\n\n对你在选的协作工具来说，支持 SSO 主要省的是**账号开通和回收的手工活**，也降低了离职员工还能登录的风险。";
  }
  if (kind === "compare" || kind === "compareEdit") {
    const edit = kind === "compareEdit";
    return [
      edit ? "已在对比里加入「数据导出」，并把风险单独突出。**结论不变：6 人团队优先考虑 A，但先问清第 6 个席位的价格。**" : "**结论：6 人团队优先考虑方案 A，但要先问清它第 6 个席位怎么收费。** B 的 6 人月费可以算出是 346 元，A 的 6 人价格你没给，我没有估。",
      "",
      fence({ type: "compare", title: "两个套餐", options: [
        { name: "方案 A", tagline: "299 元/月，含 5 席", pick: true, pros: ["保留 90 天", "支持 SSO"].concat(edit ? ["支持 CSV 导出"] : []), cons: ["第 6 个席位价格未知"] },
        { name: "方案 B", tagline: "199 元/月，含 3 席", pros: ["起步价低"], cons: ["6 人需加 3 席，共 346 元", "保留仅 30 天", "不支持 SSO"].concat(edit ? ["不能导出数据"] : []) },
      ], criteria: [
        { label: "月费", values: ["299 元", "199 元"] },
        { label: "6 人总月费", values: ["未知", "346 元（199 + 3×49）"] },
        { label: "数据保留", values: ["90 天", "30 天"] },
        { label: "SSO", values: ["支持", "不支持"] },
      ].concat(edit ? [{ label: "数据导出", values: ["支持 CSV", "不支持"] }] : []) }),
      "",
      fence({ type: "unknown", title: "还缺的信息", items: [{ question: "方案 A 第 6 个席位怎么收费？", needs: "向供应商确认加席价格或 6 人档报价" }] }),
      "",
      edit ? fence({ type: "risks", title: "风险", items: [
        { risk: "方案 B 不能导出数据，30 天后历史记录无法自行备份", impact: "high", mitigation: "若选 B，需每月手工整理关键记录", basis: "inference" },
        { risk: "方案 A 的 6 人成本未知", impact: "medium", mitigation: "签约前拿到书面报价", basis: "unknown" },
        { risk: "B 不支持 SSO，离职回收账号要手工处理", impact: "medium", mitigation: "建立离职清单", basis: "inference" },
      ] }) : null,
      edit ? "" : null,
      "下面是可交互的对比视图，可以切换突出某个方案：",
      "",
      `<kern-artifact key="plan-compare" title="协作工具套餐对比" kind="compare">`,
      compareHtml(edit),
      "</kern-artifact>",
      "",
      fence({ type: "sources", items: [{ n: 1, title: "你在本轮对话中提供的套餐信息与团队人数", trust: "user" }] }),
      "",
      fence({ type: "next", items: edit
        ? [{ label: "写给供应商的询价邮件", prompt: "帮我写一封询问方案 A 第 6 个席位价格的邮件" }]
        : [{ label: "加一行数据导出", prompt: PROMPTS.compareEdit }, { label: "列出要问供应商的问题", prompt: "列出签约前要向两家供应商确认的问题" }] }),
    ].filter((x) => x !== null).join("\n");
  }
  if (kind === "cost") {
    const total = costItems.reduce((a, b) => a + b.value, 0);
    return [
      `**单杯成本 ${total.toFixed(2)} 元，按 22 元售价毛利率约 ${(((22 - total) / 22) * 100).toFixed(1)}%。** 最大的一项是牛奶（3.20 元），其次是咖啡豆（2.88 元）。`,
      "",
      fence({ type: "metrics", items: [
        { label: "单杯成本", value: `¥${total.toFixed(2)}`, note: "四项相加", basis: "inference", source: 1 },
        { label: "售价", value: "¥22.00", basis: "fact", source: 1 },
        { label: "毛利率", value: `${(((22 - total) / 22) * 100).toFixed(1)}%`, note: "(22 − 成本) ÷ 22", basis: "inference", source: 1 },
      ] }),
      "",
      fence({ type: "chart", chart: "waterfall", title: "成本构成", unit: "元/杯", series: costItems.map((i) => ({ label: i.label, value: i.value })), basis: "fact", source: "用户提供的单价与用量 [1]，逐项相乘" }),
      "",
      "### 怎么算的",
      "",
      "| 项目 | 计算 | 金额（元） |",
      "|---|---|---:|",
      ...costItems.map((i) => `| ${i.label} | ${i.calc} | ${i.value.toFixed(2)} |`),
      `| **合计** |  | **${total.toFixed(2)}** |`,
      "",
      "> [!NOTE]",
      "> 没算进去的：房租、水电、设备折旧、损耗和平台抽成。你没给这些数，所以这里的毛利率偏乐观。",
      "",
      `<kern-artifact key="latte-cost" title="单杯拿铁成本拆解" kind="cost">`,
      costHtml(),
      "</kern-artifact>",
      "",
      fence({ type: "sources", items: [{ n: 1, title: "你在本轮对话中提供的用量、单价与售价", trust: "user" }] }),
      "",
      fence({ type: "next", items: [{ label: "加上房租和损耗", prompt: "我补充房租和损耗数据，帮我算完整成本" }, { label: "牛奶涨价情景", prompt: "如果牛奶涨到每升 20 元，毛利率变成多少？" }] }),
    ].join("\n");
  }
  if (kind === "plan") {
    return [
      "**排期目前卡在「设计」：品牌素材没到，开发、测试、发布都直接依赖它。** 如果素材晚到，11/30 发布会顺延，顺延天数取决于素材到的时间。",
      "",
      fence({ type: "timeline", title: "官网改版排期", items: phases.map((p) => ({ when: p.when, phase: p.phase, deliverable: p.note ? `受阻：${p.note}` : p.status === "done" ? "已完成" : "按计划", status: p.status, depends: p.depends })) }),
      "",
      fence({ type: "flow", title: "依赖链", nodes: [
        { id: "r", label: "调研", detail: "已完成" }, { id: "b", label: "品牌素材", detail: "未到" }, { id: "d", label: "设计", detail: "受阻" },
        { id: "v", label: "开发" }, { id: "t", label: "测试" }, { id: "l", label: "发布", detail: "11/30" },
      ], edges: [["r", "d"], ["b", "d"], ["d", "v"], ["v", "t"], ["t", "l"]] }),
      "",
      fence({ type: "risks", items: [
        { risk: "品牌素材迟到会整体推迟发布", impact: "high", mitigation: "先用占位素材推进页面结构设计，素材到后替换", basis: "inference" },
        { risk: "测试只有一周，没有缓冲", impact: "medium", mitigation: "开发阶段同步做冒烟测试", basis: "inference" },
      ] }),
      "",
      `<kern-artifact key="site-revamp-plan" title="官网改版排期" kind="plan">`,
      planHtml(),
      "</kern-artifact>",
      "",
      fence({ type: "next", items: [{ label: "素材晚一周怎么调", prompt: "品牌素材如果再晚一周到，排期要怎么调整？" }] }),
    ].join("\n");
  }
  if (kind === "productCompare") return productCompareReply(false);
  if (kind === "productCompareEdit" || kind === "regenPlanCompare") return productCompareReply(true);
  if (kind === "failPlanCompare") return productCompareReply(true, { truncate: true });
  if (kind === "fail") {
    return "我先给出对比结论：两套方案各有取舍。\n\n<kern-artifact key=\"broken-demo\" title=\"未完成的成果\" kind=\"other\">\n<!doctype html><html><body><h1>这个成果没有生成完";
  }
  return null;
}

function pick(text) {
  const t = String(text || "");
  if (/\[mock:artifact-fail:plan-compare\]/.test(t)) return "failPlanCompare";
  if (/\[mock:artifact-fail\]/.test(t)) return "fail";
  if (/重新生成可视化成果.*key=plan-compare/.test(t)) return "regenPlanCompare";
  if (/把第二个方案换掉/.test(t)) return "productCompareEdit";
  if (/产品方案/.test(t) && /方案 ?A/.test(t)) return "productCompare";
  if (/加一行「数据导出」|突出风险/.test(t)) return "compareEdit";
  if (/方案 ?A.*方案 ?B|两个协作工具套餐/.test(t)) return "compare";
  if (/拿铁成本|单杯.*成本/.test(t)) return "cost";
  if (/改版排期|官网改版/.test(t)) return "plan";
  if (/SSO\s*是什么意思/.test(t)) return "short";
  return null;
}

module.exports = { PROMPTS, reply, pick, compareHtml, costHtml, planHtml, productCompareHtml };
