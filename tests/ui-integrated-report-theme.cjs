/* Real React components + actual imported CSS, rendered offline in Chrome.
 * No app server, database, model, login, or business endpoint is used.
 * Run from the worktree: node tests/ui-report-card-theme.cjs [baseline|fixed]
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { build } = require('esbuild');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const { chromium } = require('playwright');
const stage = process.argv[2] || 'fixed';
const mutation = process.env.REPORT_CARD_MUTATION || '';
const originalMode = process.env.REPORT_CARD_SOURCE === 'original';
const originals = new Set(["src/app/muse/components/mission-conclusion-rich.tsx", "src/app/muse/components/mission-conclusion-rich.css", "src/app/muse/rich/rich.css", "src/app/muse/response/response-role.css"]);
function sourceText(file) {
  const relative=path.relative(process.cwd(),file).split(path.sep).join('/');
  if(originalMode && originals.has(relative)) return fs.readFileSync(path.resolve('outputs/block-1-theme/original-source',relative.endsWith('.tsx')?relative+'.snapshot':relative),'utf8');
  return fs.readFileSync(file,'utf8');
}
const output = path.resolve('outputs/block-1-theme', stage);
fs.mkdirSync(output, { recursive: true });
function cssFile(file, stack = []) {
  file = path.resolve(file);
  assert(!stack.includes(file), 'cyclic stylesheet import');
  return sourceText(file).replace(/@import\s+["']([^"']+)["']\s*;/g,
    (_, relative) => cssFile(path.resolve(path.dirname(file), relative), [...stack, file]));
}
async function main() {
  if(originalMode) {
    const crypto=require('node:crypto'),before=JSON.parse(fs.readFileSync('outputs/block-1-theme/pre-integration-source-sha.json'));
    for(const file of originals) assert.equal(crypto.createHash('sha256').update(sourceText(path.resolve(file))).digest('hex'),before[file],'original snapshot hash '+file);
  }
  const entry = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { ReportCard } from './src/app/muse/rich/report-card';
    import { MissionConclusionRich } from './src/app/muse/components/mission-conclusion-rich';
    import { RoleProvider, useRole } from './src/components/role-context';
    import { categoryKeys, categoryMeta, classifyCategoryByText } from './src/modules/tenant';
    const categories = [...new Map(categoryKeys().map(key => {
      const sampleText = categoryMeta(key).name;
      const classified = classifyCategoryByText(sampleText);
      return [classified, {...categoryMeta(classified), sampleText}];
    })).values()];
    function FixtureRole({role,children}) {
      const {setManualRole} = useRole();
      React.useEffect(()=>setManualRole(role),[role]);
      return children;
    }
    const citation = {kind:'executive-report', ref:'offline-fixture',title:'报告卡片颜色回归 · 长标题及待审校状态',contentVersion:3,reviewStatus:'PENDING',summary:'离线视觉测试数据；报告内容、落库与模型能力不属于本测试。',stats:{conclusions:4,verified:3,risks:2,unknowns:1,decisions:2}};
    const envelope = {v:1,kind:'CONCLUSION',demo:true,lede:'结论需要负责人复核',confidence:'MEDIUM',blocks:[{type:'prose',body:['主要卖点：用户偏好销售视角，首轮预算3万元内，优先验证内容种草与直播电商。']},{type:'prose',body:['结论：推荐高蛋白海苔脆（测试样例，非事实核验）。','需要负责人确认验证预算与渠道选择。']},{type:'decision',headline:'请负责人复核',confidence:'MEDIUM',recommend:['先完成复核'],against:['暂不直接发布'],risks:['结论尚待验证']}],meta:{model:'offline-fixture',elapsedMs:10,steps:1,quota:null,memoriesUsed:[],sources:0}};
    window.fetch = async input => {
      const url = String(input);
      if(url === '/api/memory/role') return {ok:true,json:async()=>({preference:null})};
      if(url.startsWith('/api/missions/')) return {ok:true,json:async()=>({envelope,renderable:url.includes('loaded-')})};
      throw new Error('unexpected fixture fetch: '+url);
    };
    const all = categories.flatMap(cat => ['leadership','product','sales'].flatMap(role => ['fallback','loaded'].map(state => ({cat,role,state}))));
    window.fixtureExpectedLoaded = categories.length * 3;
    window.fixtureCategories = categories.map(cat=>({key:cat.key,classified:classifyCategoryByText(cat.sampleText)}));
    createRoot(document.getElementById('root')).render(<main className="muse" data-theme={window.fixtureTheme}>
      {['DELIVERABLE','DRAFT_UNVERIFIED','BLOCKED'].map(qualityStatus=><section className="fixture" key={qualityStatus}><ReportCard citation={{...citation,qualityStatus}}/></section>)}
      {all.map(({cat,role,state})=><section className="fixture" key={cat.key+role+state} data-case={cat.key+'-'+role+'-'+state}>
        <RoleProvider defaultRole={role}><FixtureRole role={role}><MissionConclusionRich missionId={state+'-'+cat.key+'-'+role} text={cat.sampleText+'：已整理任务结论，下一步由负责人复核。'}/></FixtureRole></RoleProvider>
      </section>)}
    </main>);
  `;
  const bundle = await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'offline-card-fixture.tsx',loader:'tsx'},plugins:originalMode?[{name:'original-theme-snapshot',setup(b){b.onLoad({filter:/mission-conclusion-rich\.tsx$/},args=>({contents:sourceText(args.path),loader:'tsx',resolveDir:path.dirname(args.path)}));}}]:[],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.resolve('tsconfig.json'),loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"test"','process.env.NEXT_PUBLIC_KERN_TENANT_PACK':'"health-food"'}});
  const styles = [ 'src/app/globals.css','src/app/muse/muse.css','src/app/muse/response/response.css','src/app/muse/response/response-role.css','src/components/role-switch.css','src/app/muse/components/mission-conclusion-rich.css','src/app/muse/rich/rich.css' ].map(p=>cssFile(p)).join('\n');
  const compiled = await postcss([tailwind({content:[{raw:entry+' <body class="antialiased"></body>',extension:'tsx'}],theme:{extend:{}},plugins:[]})]).process(styles,{from:undefined});
  const regression = mutation === 'sales' ? '.rb-sales-prose { background:linear-gradient(180deg,#fdf3e2,white); }' : mutation === 'gradient' ? '.conclusion-header,.conclusion-meta-bar { background:linear-gradient(135deg,#fffbeb,#fef3c7); }' : mutation === 'meta' ? '.kxr-report-ver,.kxr-report-status { color:var(--m-ink-4); }' : '';
  const css = compiled.css + regression + '\n.muse {display:block;padding:24px;min-width:0;} .fixture {max-width:920px;margin:0 auto 24px;}';
  const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : chromium.executablePath()),headless:true,args:['--no-sandbox','--no-proxy-server']});
  const results = [];
  try {
    for(const width of [1440,390]) for(const theme of ['light','dark']) for(const scope of ['muse','ancestor']) {
      const page = await browser.newPage({viewport:{width,height:1000},colorScheme:theme,reducedMotion:'reduce'});
      const errors = [], network = [];
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',route=>{ network.push(route.request().url()); return route.abort(); });
      await page.setContent('<!doctype html><html'+(scope==='ancestor'?' data-theme="'+theme+'"':'')+'><head><meta charset="utf-8"><style>'+css+'</style></head><body><div id="root"></div></body></html>');
      const previewHtml = '<!doctype html><html'+(scope==='ancestor'?' data-theme="'+theme+'"':'')+'><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body><div id="root"></div><script>window.fixtureTheme='+JSON.stringify(scope==='muse'?theme:null)+';<'+ '/script><script>'+bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')+';<'+ '/script></body></html>';
      fs.writeFileSync(path.join(output,`fixture-${theme}-${scope}-${width}.html`),previewHtml);
      await page.evaluate(t=>{window.fixtureTheme=t;},scope==='muse'?theme:undefined);
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      await page.waitForFunction(()=>document.querySelectorAll('.mission-conclusion-rich-wrapper').length===window.fixtureExpectedLoaded && document.querySelectorAll('.mission-conclusion-rich').length===window.fixtureExpectedLoaded && new Set([...document.querySelectorAll('.rb-response')].map(el=>el.getAttribute('data-role'))).size===3);
      await page.waitForFunction(()=>document.querySelectorAll('.kxr-report').length===3&&document.querySelectorAll('.kxr-report-quality').length===2&&document.querySelectorAll('.rb-sales-prose').length===6);
      assert.deepEqual(await page.locator('.kxr-report-quality').evaluateAll(es=>es.map(e=>e.dataset.status).sort()),['BLOCKED','DRAFT_UNVERIFIED']);
      await page.evaluate(()=>document.fonts.ready);
      const audit = await page.evaluate(()=>{
        const parse = s => {const m=s.match(/^rgba?\(([^)]+)\)/); if(!m) throw Error('unsupported computed color '+s);const v=m[1].split(/[ ,/]+/).map(Number);return [v[0],v[1],v[2],v.length>3?v[3]:1];};
        const over = (fg,bg) => fg.slice(0,3).map((c,i)=>c*fg[3]+bg[i]*(1-fg[3]));
        const lum = rgb => rgb.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0);
        const ratio = (a,b) => (Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
        function backgrounds(el) {
          let choices=[[255,255,255]];
          const chain=[];for(let e=el;e;e=e.parentElement)chain.unshift(e);
          for(const e of chain) {
            const s=getComputedStyle(e),bg=parse(s.backgroundColor);
            choices=choices.map(c=>over(bg,c));
            if(s.backgroundImage!=='none') {
              if(!/^(linear|radial)-gradient/.test(s.backgroundImage)) throw Error('unsupported background '+s.backgroundImage);
              const stops=[...s.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map(x=>parse(x[0]));
              if(!stops.length) throw Error('missing gradient samples');
              // Conservative stop samples; production target has opaque theme surfaces after repair.
              choices=choices.flatMap(c=>stops.map(stop=>over(stop,c)));
            }
          }
          return choices;
        }
        const failures=[],samples=[];
        const roots=[...document.querySelectorAll('.kxr-report,.mission-conclusion-rich,.mission-conclusion-rich-wrapper')];
        for(const root of roots) {
          const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let text;
          while(text=walker.nextNode()) {
            if(!text.textContent.trim())continue;
            const el=text.parentElement,s=getComputedStyle(el);
            if(s.display==='none'||s.visibility==='hidden'||!el.getClientRects().length)continue;
            const foreground=parse(s.color),bgs=backgrounds(el);
            const worst=Math.min(...bgs.map(bg=>ratio(over(foreground,bg),bg)));
            const sample={selector:el.tagName.toLowerCase()+'.'+el.className,text:text.textContent.trim().slice(0,60),ratio:+worst.toFixed(2),fg:s.color,bg:getComputedStyle(root).backgroundColor,case:el.closest('[data-case]')?.getAttribute('data-case')||'report'};
            samples.push(sample);if(worst<4.5)failures.push(sample);
          }
        }
        const cards=roots.map(el=>({class:el.className,bg:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color}));
        const names=['.kxr-report','.kxr-report-title','.kxr-report-ver','.kxr-report-status','.kxr-report-thumb','.kxr-report-cover','.kxr-report-cover-title'];
        const report=names.map(selector=>{const s=getComputedStyle(document.querySelector(selector));return {selector,background:s.backgroundColor,color:s.color};});
        return {failures,sampleCount:samples.length,minRatio:Math.min(...samples.map(s=>s.ratio)),cards,report,overflow:document.documentElement.scrollWidth>innerWidth,classification:window.fixtureCategories,roles:[...document.querySelectorAll('.rb-response')].map(el=>el.getAttribute('data-role')),expectedLoaded:window.fixtureExpectedLoaded,loaded:document.querySelectorAll('.rb-response').length};
      });
      await page.screenshot({path:path.join(output,`${theme}-${width}-${scope}.png`)});
      results.push({width,theme,scope,...audit,errors,blockedNetworkRequests:network.length});
      await page.close();
    }
  } finally {await browser.close();}
  const report={stage,mutation:mutation || null,kind:'offline-real-components-not-server-e2e',results};
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({stage,cases:results.length,samples:results.reduce((n,r)=>n+r.sampleCount,0),failures:results.reduce((n,r)=>n+r.failures.length,0),minRatio:Math.min(...results.map(r=>r.minRatio)),overflowCases:results.filter(r=>r.overflow).length,pageErrors:results.flatMap(r=>r.errors),loadedCards:results.map(r=>r.loaded),output},null,2));
  assert(results.every(r=>r.failures.length===0 && !r.overflow && r.errors.length===0 && r.loaded===r.expectedLoaded && r.expectedLoaded>=3 && new Set(r.roles).size===3 && r.classification.every(c=>c.key===c.classified)),'report/conclusion visual regression failed; see results.json');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
