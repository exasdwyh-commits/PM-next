// 把自包含的长文档 HTML 渲染成多页 PDF（A4，遵循 HTML 内 @page 规则）。
//
// 用法：node scripts/render-panorama-pdf.mjs <输入.html> <输出.pdf>
//
// 注意（本机环境）：
//   - 本机代理会劫持 localhost / file://，chromium 必须带 --no-proxy-server。
//   - 显式给 executablePath：项目 playwright 不保证能找到匹配的浏览器版本。
//   - page.pdf() 只在 headless 下可用；preferCSSPageSize 让 HTML 里的 @page 生效。

import { chromium } from "playwright";
import { pathToFileURL } from "node:url";

const HTML = process.argv[2];
const OUT = process.argv[3];

if (!HTML || !OUT) {
  console.error("用法: node scripts/render-panorama-pdf.mjs <输入.html> <输出.pdf>");
  process.exit(2);
}

const EXECUTABLE_PATH =
  process.env.CHROMIUM_EXEC ??
  "/Users/exasdwyh/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

const browser = await chromium.launch({
  headless: true,
  executablePath: EXECUTABLE_PATH,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
});

try {
  const page = await browser.newPage();
  await page.emulateMedia({ media: "print" });
  await page.goto(pathToFileURL(HTML).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);

  await page.pdf({
    path: OUT,
    printBackground: true,
    preferCSSPageSize: true,
  });

  console.log(`PDF 已生成 → ${OUT}`);
} finally {
  await browser.close();
}
