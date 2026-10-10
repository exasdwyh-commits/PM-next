import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../package.json', import.meta.url));
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT = process.env.OUTPUT_DIR || path.join(ROOT, 'outputs/ux');
const BASE = process.env.PM_UX_PREVIEW_URL || 'http://127.0.0.1:5173';
fs.mkdirSync(OUTPUT, { recursive: true });
const results = [];
// Cloud runner startup readiness. This only reads the isolated fixture server.
async function waitForPreview() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { if ((await fetch(BASE, { signal: AbortSignal.timeout(2000) })).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Fixture preview did not become ready within 30 seconds');
}
await waitForPreview();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1568, height: 900 }, timezoneId: 'Asia/Shanghai', colorScheme: 'light' });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
async function check(name, fn) { await fn(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
async function choose(value) { await page.getByLabel('预览场景').selectOption(value); }
async function surface(value) { await page.locator('.preview-switch button').nth(value === 'manage' ? 1 : 0).click(); }
async function waitReady() { await page.waitForFunction(() => !document.querySelector('.m-briefing-status[aria-busy="true"]')); }
async function noOverflow() {
  const sizes = await page.evaluate(() => ({ w: document.documentElement.clientWidth, s: document.documentElement.scrollWidth }));
  assert.ok(sizes.s - sizes.w <= 1, `横向溢出 ${sizes.s - sizes.w}px`);
  const offenders = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll('.m-top *, .m-role-bar *, .kx-wb-start *, .kx-wb-example')].filter((element) => {
      const box = element.getBoundingClientRect(); const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.right > width + 1;
    }).map((element) => String(element.className));
  });
  assert.deepEqual(offenders, []);
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await check('空对话欢迎内容在首屏；没有示例仪表盘或虚构标题', async () => {
    await page.locator('.m-home').waitFor(); await waitReady();
    assert.equal(await page.locator('.daily-briefing-rich').count(), 0);
    assert.equal(await page.locator('.m-briefing').count(), 0);
    assert.equal(await page.locator('.m-briefing-empty').count(), 1);
    assert.ok((await page.locator('.m-home-head').boundingBox()).y < 360);
    assert.equal((await page.locator('.m-scroll').innerText()).includes('多酚软糖'), false);
    await noOverflow();
  });
  await check('写下目标只聚焦输入，不发送或清空已有草稿', async () => {
    await page.getByLabel('对 Kern 说').fill('保留这段已有草稿');
    await page.getByRole('button', { name: '写下一个目标' }).click();
    assert.equal(await page.getByLabel('对 Kern 说').inputValue(), '保留这段已有草稿');
    await page.waitForFunction(() => document.querySelector('.m-dock textarea') === document.activeElement);
    assert.equal(await page.getByLabel('对 Kern 说').evaluate((node) => node === document.activeElement), true);
  });
  await check('目标模板追加进草稿，保留按钮语义与焦点', async () => {
    await page.getByRole('button', { name: /评估一个新品方向/ }).click();
    const value = await page.getByLabel('对 Kern 说').inputValue();
    assert.ok(value.startsWith('保留这段已有草稿\n')); assert.ok(value.includes('我想开发一个新的产品'));
    await page.waitForFunction(() => document.querySelector('.m-dock textarea') === document.activeElement);
    assert.equal(await page.getByLabel('对 Kern 说').evaluate((node) => node === document.activeElement), true);
    const writes = await page.evaluate(() => window.__previewRequests.filter((r) => r.path.includes('/api/conversations') && r.method !== 'GET'));
    assert.deepEqual(writes, []);
  });
  await check('更多保留五个工具；Escape 收起并恢复焦点', async () => {
    await page.locator('.m-top-more > summary').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.m-top-more').open);
    assert.equal(await page.locator('.m-tool-popover button').count(), 5);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.m-top-more').evaluate((node) => node.open), false);
    assert.equal(await page.locator('.m-top-more > summary').evaluate((node) => node === document.activeElement), true);
  });
  await check('更多可以点击外部关闭，不吞掉目标入口点击', async () => {
    await page.locator('.m-top-more > summary').click();
    await page.getByRole('button', { name: '写下一个目标' }).click();
    assert.equal(await page.locator('.m-top-more').evaluate((node) => node.open), false);
  });
  await check('工具入口打开说明后，关闭回到始终可见的入口', async () => {
    await page.locator('.m-top-more > summary').click();
    await page.locator('.m-tool-popover button').first().click();
    await page.getByRole('heading', { name: '记忆', exact: true }).waitFor(); await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.m-top-more > summary') === document.activeElement);
    assert.equal(await page.locator('.m-top-more > summary').evaluate((node) => node === document.activeElement), true);
  });
  await page.getByLabel('对 Kern 说').fill('');
  await page.screenshot({ path: path.join(OUTPUT, 'conversation-desktop.png'), fullPage: true });

  await choose('project'); await page.locator('.m-briefing').waitFor();
  await check('有记录时简报默认折叠；用原生键盘交互展开', async () => {
    assert.equal(await page.locator('.m-briefing').evaluate((node) => node.open), false);
    await page.locator('.m-briefing > summary').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.m-briefing').open);
    assert.ok((await page.locator('.m-briefing-body').innerText()).includes('5/8'));
    assert.equal((await page.locator('.m-briefing-body').innerText()).includes('已调度'), false);
    assert.equal((await page.locator('.m-briefing-body').innerText()).includes('预计今日'), false);
  });
  await check('建议按钮真正追加待审查草稿，不自动发送', async () => {
    await page.getByLabel('对 Kern 说').fill('已有目标');
    await page.locator('[data-briefing-action]').first().click();
    const value = await page.getByLabel('对 Kern 说').inputValue();
    assert.ok(value.startsWith('已有目标\n')); assert.ok(value.includes('审查 1 项待决策事项'));
    await page.waitForFunction(() => document.querySelector('.m-dock textarea') === document.activeElement);
    assert.equal(await page.getByLabel('对 Kern 说').evaluate((node) => node === document.activeElement), true);
  });
  await page.getByLabel('对 Kern 说').fill('');
  await page.screenshot({ path: path.join(OUTPUT, 'briefing-expanded-desktop.png'), fullPage: true });
  await check('回复视角按钮显式选中，且不会修改权限', async () => {
    await page.getByRole('button', { name: '销售', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '销售', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('button', { name: '研发', exact: true }).getAttribute('aria-pressed'), 'false');
  });
  await check('快速切换视角时慢旧响应不能覆盖新简报', async () => {
    await page.evaluate(() => {
      const original = window.fetch;
      window.__originalPreviewFetch = original;
      window.fetch = async (input, init) => {
        const url = new URL(String(input), window.location.origin);
        if (url.pathname !== '/api/assistant/daily-briefing') return original(input, init);
        const slow = url.searchParams.get('role') === 'leadership';
        // 故意不响应 AbortSignal，确保组件本身也检查 aborted。
        await new Promise((resolve) => setTimeout(resolve, slow ? 600 : 30));
        return Response.json({ briefing: { todos: 1, decisions: 0, gaps: 0, risks: 0, evidenceRate: 100, workRate: 0,
          verifiedCount: 1, totalEvidence: 1, doneWork: 0, totalWork: 1, category: 'health_food', projectCount: 1,
          scopeLabel: '验收夹具', projectTitle: slow ? '过期响应' : '最新响应', suggestions: [], generatedAt: '2026-10-10T01:55:00.000Z' } });
      };
    });
    await page.getByRole('button', { name: '领导', exact: true }).click();
    await page.waitForTimeout(50);
    await page.getByRole('button', { name: '销售', exact: true }).click();
    await page.getByText('最新响应', { exact: true }).waitFor();
    await page.waitForTimeout(700);
    assert.equal(await page.locator('.m-briefing-heading strong').innerText(), '最新响应');
    await page.evaluate(() => { window.fetch = window.__originalPreviewFetch; });
  });
  await choose('existing'); await page.locator('.m-briefing').waitFor();
  await check('项目存在但没有记录时，不画 0/0 或 100% 待验收', async () => {
    await page.locator('.m-briefing > summary').click();
    const text = await page.locator('.m-briefing-body').innerText();
    assert.ok(text.includes('尚未建立证据')); assert.ok(text.includes('尚未建立工作项'));
    assert.equal(text.includes('0/0'), false); assert.equal(text.includes('100%'), false);
  });
  await choose('error');
  await check('读取失败保持真实错误状态，重试可恢复为空', async () => {
    await page.getByText('项目简报暂时不可用', { exact: true }).waitFor();
    assert.equal(await page.locator('.m-briefing').count(), 0);
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.locator('.m-briefing-empty').waitFor();
  });

  await surface('manage'); await choose('empty');
  await check('新工作台展示一个开始入口，不展示五张全零卡片', async () => {
    await page.locator('.kx-wb-start').waitFor();
    assert.equal(await page.locator('.kx-wb-card').count(), 0);
    assert.equal(await page.locator('.kx-wb-start-cta').count(), 1);
    assert.equal(await page.locator('.kx-wb-example').count(), 3);
    await noOverflow();
  });
  await page.screenshot({ path: path.join(OUTPUT, 'workbench-desktop.png'), fullPage: true });
  await check('工作台主入口携带真实查询草稿交接到对话', async () => {
    await page.locator('.kx-wb-start-cta').click();
    await page.getByLabel('对 Kern 说').waitFor();
    assert.ok((await page.getByLabel('对 Kern 说').inputValue()).includes('我想创建第一个产品'));
    await surface('manage');
  });
  await choose('existing');
  await check('有独立项目而没有产品时，不误判为首次使用', async () => {
    assert.equal(await page.locator('.kx-wb-start').count(), 0);
    assert.equal(await page.getByRole('heading', { name: '今日工作', exact: true }).count(), 1);
  });
  await choose('warning');
  await check('空工作空间的告警与数据降级仍然可见，且在开始入口之前', async () => {
    await page.locator('.kx-wb-setup-notice').waitFor();
    const text = await page.locator('.kx-wb-setup-notice').innerText();
    assert.ok(text.includes('模型尚未就绪')); assert.ok(text.includes('部分信息暂未更新'));
    assert.ok((await page.locator('.kx-wb-setup-notice').boundingBox()).y < (await page.locator('.kx-wb-start').boundingBox()).y);
  });
  await choose('project');
  await check('真实内容分支保留待决策、阻塞、活动与完成入口；历史活动不冒充运行中', async () => {
    const text = await page.locator('.kx-wb').innerText();
    for (const phrase of ['确认第一轮样品验证范围', '补充供应商检测报告', '自动化活动', '整理竞品对比资料']) assert.ok(text.includes(phrase));
    assert.equal(text.includes('Kern 正在工作'), false);
    await noOverflow();
  });
  await page.screenshot({ path: path.join(OUTPUT, 'workbench-populated-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 }); await choose('empty');
  await check('390px 工作台无横向溢出，主按钮与导航可触达', async () => {
    await noOverflow(); assert.ok((await page.locator('.kx-wb-start-cta').boundingBox()).height >= 44);
  });
  await page.screenshot({ path: path.join(OUTPUT, 'workbench-mobile.png'), fullPage: true });
  await surface('muse'); await waitReady();
  await check('390px 对话无横向溢出，工具和视角点击区域至少 44px', async () => {
    await noOverflow();
    for (const selector of ['.m-tool-trigger', '.m-role-options button', '.m-send']) {
      const rects = await page.locator(selector).evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
      assert.ok(rects.every((height) => height >= 44));
    }
    assert.ok(await page.locator('.m-scroll').evaluate((node) => node.clientHeight) > 200);
  });
  await page.getByLabel('对 Kern 说').fill('');
  await page.screenshot({ path: path.join(OUTPUT, 'conversation-mobile.png'), fullPage: true });
  await check('手机长草稿增长后，滚动到末尾的内容不被输入区挡住', async () => {
    await page.getByLabel('对 Kern 说').fill(Array.from({ length: 18 }, (_, index) => `约束说明第 ${index + 1} 行`).join('\n'));
    await page.waitForTimeout(100);
    const gap = await page.evaluate(() => {
      const scroll = document.querySelector('.m-scroll'); scroll.scrollTop = scroll.scrollHeight;
      const reserved = parseFloat(document.querySelector('.m-main').style.getPropertyValue('--m-dock-space'));
      return { reserved, dock: document.querySelector('.m-dock').getBoundingClientRect().height };
    });
    assert.ok(gap.reserved >= gap.dock + 20);
    await page.waitForFunction(() => {
      const scroll = document.querySelector('.m-scroll');
      return Math.abs(scroll.scrollTop + scroll.clientHeight - scroll.scrollHeight) < 2;
    });
    const safe = await page.evaluate(() => document.querySelector('.m-briefing-empty').getBoundingClientRect().bottom <= document.querySelector('.m-dock-inner').getBoundingClientRect().top - 4);
    assert.equal(safe, true);
  });
  await page.getByLabel('对 Kern 说').fill('');
  await page.setViewportSize({ width: 320, height: 720 });
  await check('320px 小屏仍然无横向溢出', noOverflow);
  await page.setViewportSize({ width: 390, height: 844 });
  await context.setExtraHTTPHeaders({});
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await check('深色与减少动态效果时内容和操作仍可见', async () => {
    await noOverflow();
    const result = await page.getByRole('button', { name: '写下一个目标' }).evaluate((node) => ({ color: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor, transition: getComputedStyle(node).transitionDuration }));
    assert.notEqual(result.color, result.background);
    assert.ok(['0s', '1e-05s', '0.00001s'].includes(result.transition));
  });
  await page.screenshot({ path: path.join(OUTPUT, 'conversation-mobile-dark.png'), fullPage: true });
  await check('全部场景无 JavaScript 运行时异常', async () => assert.deepEqual(errors, []));
  fs.writeFileSync(path.join(OUTPUT, 'browser-checks.json'), JSON.stringify({ base: BASE, fixtureOnly: true, timezone: 'Asia/Shanghai', checks: results.length, errors, results }, null, 2));
  console.log(`\n${results.length} browser checks passed. Screenshots: ${OUTPUT}`);
} finally {
  await browser.close();
}
