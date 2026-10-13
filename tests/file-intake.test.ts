/**
 * 文件读取栈的单测。
 *
 * 这里全部用**当场构造的最小样本**，不依赖 fixtures 目录也不依赖数据库：
 * 格式解析是纯函数行为，引入外部样本只会让「样本坏了」和「解析器坏了」混在一起。
 *
 * 断言的着力点是三条容易被写错、错了又不容易被发现的线：
 *  1. **结构有没有留住** —— 标题层级、表格行列、幻灯片页码、备注。只校验「文字在不在」
 *     会漏掉「全是字但结构全平」这种退化；
 *  2. **不支持与失败是不是分开的** —— UNSUPPORTED 与 FAILED 是两个真相，
 *     混成一个会让上层对着没有任何内容的回复说「文件是空的」；
 *  3. **有没有如实说明没读到什么** —— 扫描型 PDF 与只登记元信息的图片都必须写在 note 里。
 */
import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { Packer as DocxPacker, Document, Paragraph, HeadingLevel, Table, TableRow, TableCell } from "docx";
import { MAX_EXTRACTED_CHARS, extensionOf, parseAttachment, parserForExtension, supportedExtensions } from "../src/modules/file-intake";

// ---------------------------------------------------------------------------
// 样本构造
// ---------------------------------------------------------------------------

async function minimalDocx(): Promise<Buffer> {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: "季度复盘", heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: "留存率同比下降 3 个百分点。" }),
        new Paragraph({ text: "渠道表现", heading: HeadingLevel.HEADING_2 }),
        new Table({
          rows: [
            new TableRow({ children: [new TableCell({ children: [new Paragraph("渠道")] }), new TableCell({ children: [new Paragraph("成交额")] })] }),
            new TableRow({ children: [new TableCell({ children: [new Paragraph("私域")] }), new TableCell({ children: [new Paragraph("120 万")] })] }),
          ],
        }),
      ],
    }],
  });
  return DocxPacker.toBuffer(doc);
}

/** 手造两页 pptx，其中第一页带演讲者备注。 */
async function minimalPptx(): Promise<Buffer> {
  const zip = new JSZip();
  const slide = (title: string, body: string) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>
<p:sp><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:txBody><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`;
  zip.file("ppt/slides/slide1.xml", slide("战略规划", "第一步：完成核心品类验证"));
  zip.file("ppt/slides/slide2.xml", slide("预算分配", "研发投入占比 35%"));
  zip.file(
    "ppt/notesSlides/notesSlide1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>
<p:sp><p:txBody><a:p><a:r><a:t>这一步必须在 Q1 完成。</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:notes>`
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function minimalXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("渠道明细");
  ws.addRow(["渠道", "成交额"]);
  ws.addRow(["私域", 120]);
  wb.addWorksheet("汇总").addRow(["合计", 120]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 单页、带一行 Helvetica 文字的最小 PDF。 */
function minimalPdf(line: string): Buffer {
  const content = `BT /F1 16 Tf 40 720 Td (${line}) Tj ET`;
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

function minimalPng(width: number, height: number): Buffer {
  const buf = Buffer.alloc(41);
  buf.writeUInt32BE(0x89504e47, 0);
  buf.write("IHDR", 12, 4, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function read(filename: string, buffer: Buffer, mimeType = "") {
  return parseAttachment({ buffer, filename, mimeType, byteSize: buffer.length });
}

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------

test("FI1 注册表：扩展名→解析器分派覆盖全部宣称支持的格式", () => {
  for (const ext of [".pdf", ".docx", ".pptx", ".xlsx", ".html", ".md", ".csv", ".json", ".txt", ".png", ".mp4"]) {
    assert.ok(parserForExtension(`sample${ext}`), `缺少 ${ext} 的解析器`);
  }
  assert.equal(parserForExtension("sample.exe"), null, "未支持的格式不应命中任何解析器");
  assert.equal(extensionOf("dir/sub/Report.PDF"), ".pdf", "扩展名应忽略大小写并取最后一段");
  assert.equal(extensionOf("没有扩展名"), "");
  assert.ok(supportedExtensions().includes(".pptx"));
});

test("FI2 不支持的格式返回 UNSUPPORTED，且不谎称读过内容", async () => {
  const result = await read("design.psd", Buffer.from("8BPS0001"));
  assert.equal(result.status, "UNSUPPORTED");
  assert.equal(result.kind, null);
  assert.equal(result.text, "");
  assert.ok(result.note?.includes("暂不支持"), "必须明确告诉上层「不支持」，而不是给空正文让人猜");
});

// ---------------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------------

test("FI3 docx：标题层级、正文与表格行列都被保留", async () => {
  const result = await read("sample.docx", await minimalDocx());
  assert.equal(result.status, "READY");
  assert.equal(result.kind, "docx");
  assert.match(result.text, /# 季度复盘/, "一级标题要转成 markdown 层级");
  assert.match(result.text, /## 渠道表现/, "二级标题要转成 markdown 层级");
  // 表格若被当成散段落，这里会退化成四行独立文字，正是 history 上踩过的坑
  assert.match(result.text, /渠道 \| 成交额/, "表格必须以列分隔的形式出现");
  assert.match(result.text, /私域 \| 120 万/);
  assert.ok(result.meta.headings?.includes("# 季度复盘"));
});

// ---------------------------------------------------------------------------
// PowerPoint
// ---------------------------------------------------------------------------

test("FI4 pptx：按页编号整理，演讲者备注单独标出", async () => {
  const result = await read("sample.pptx", await minimalPptx(), "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  assert.equal(result.status, "READY");
  assert.equal(result.meta.slideCount, 2);
  assert.match(result.text, /## 第 1 页/);
  assert.match(result.text, /## 第 2 页/);
  assert.match(result.text, /战略规划/);
  assert.match(result.text, /演讲者备注/, "备注是 PPT 里信息密度最高的部分，不能丢");
  assert.match(result.text, /Q1 完成/);
});

test("FI5 pptx 页码按数字排序：slide10 必须排在 slide2 之后", async () => {
  const zip = new JSZip();
  for (const n of [1, 2, 10]) {
    zip.file(
      `ppt/slides/slide${n}.xml`,
      `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>第${n}页内容</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
  }
  const result = await read("multi.pptx", await zip.generateAsync({ type: "nodebuffer" }));
  assert.equal(result.meta.slideCount, 3);
  const order = [...result.text.matchAll(/第(\d+)页内容/g)].map((m) => Number(m[1]));
  assert.deepEqual(order, [1, 2, 10], "字典序会把 slide10 排到 slide2 之前");
});

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

test("FI6 xlsx：多工作表分开列出，共享字符串还原成真实值", async () => {
  const result = await read("sample.xlsx", await minimalXlsx());
  assert.equal(result.status, "READY");
  assert.deepEqual(result.meta.sheetNames, ["渠道明细", "汇总"]);
  assert.match(result.text, /## 工作表：渠道明细/);
  assert.match(result.text, /## 工作表：汇总/);
  // 数字列以外的「私域」走的是 sharedStrings 引用，取不到就只剩空管道
  assert.match(result.text, /私域 \| 120/);
  assert.ok(result.note?.includes("|"), "要向模型说明单元格的分隔方式");
});

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

test("FI7 pdf：抽出文字并标注页码", async () => {
  const result = await read("sample.pdf", minimalPdf("Kern revenue report 1200 CNY"));
  assert.equal(result.status, "READY");
  assert.equal(result.meta.pageCount, 1);
  assert.match(result.text, /## 第 1 页/);
  assert.match(result.text, /Kern revenue report/);
});

test("FI8 pdf：扫描型（无文字层）必须被识别并说明，不得当作读成功", async () => {
  // 页面存在但一个字都没有 —— 这就是扫描件的特征
  const result = await read("scanned.pdf", minimalPdf(""));
  assert.equal(result.status, "READY");
  assert.ok(result.note?.includes("扫描"), "低字符密度必须提示疑似扫描件");
  assert.ok(!result.text.replace(/## 第 1 页|（本页无文字）/g, "").trim(), "不应产出凭空的内容");
});

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

test("FI9 html：剔除脚本与样式，保留标题层级与链接地址", async () => {
  const html = `<!doctype html><html><head><title>成分白皮书</title>
<style>.x{color:red}</style><script>tracking()</script></head><body>
<nav>首页 关于</nav>
<h1>核心成分</h1><p>临床剂量每日 250mg。</p>
<ul><li>无严重不良反应</li></ul>
<p>详见 <a href="https://example.org/study">双盲试验</a>。</p>
</body></html>`;
  const result = await read("page.html", Buffer.from(html), "text/html");
  assert.equal(result.status, "READY");
  assert.match(result.text, /# 成分白皮书/);
  assert.doesNotMatch(result.text, /tracking\(\)/, "脚本必须剔除");
  assert.doesNotMatch(result.text, /color:red/, "样式必须剔除");
  assert.doesNotMatch(result.text, /首页 关于/, "导航区块不该进入正文");
  assert.match(result.text, /250mg/);
  assert.match(result.text, /双盲试验（https:\/\/example\.org\/study）/, "链接要带上地址才有追问路径");
  assert.match(result.text, /- 无严重不良反应/, "列表结构要保留");
});

// ---------------------------------------------------------------------------
// 纯文本家族
// ---------------------------------------------------------------------------

test("FI10 csv：给出行列规模，正文不超过预览上限", async () => {
  const rows = ["渠道,成交额,同比"];
  for (let i = 0; i < 600; i += 1) rows.push(`渠道${i},${i},+${i}%`);
  const result = await read("data.csv", Buffer.from(rows.join("\n")), "text/csv");
  assert.equal(result.status, "READY");
  assert.equal(result.meta.rowCount, 601);
  assert.equal(result.meta.columnCount, 3);
  assert.match(result.text, /601 行 × 3 列/, "规模要说清楚，否则模型会把预览当全文");
  assert.match(result.text, /其余 401 行未列出/, "必须说明被省略，不能让模型以为看全了");
});

test("FI11 json：描述形状而非整篇摊开；坏 JSON 也返回原始文本", async () => {
  const ok = await read(
    "data.json",
    Buffer.from(JSON.stringify({ report: "Q3", rows: [{ gmv: 120 }, { gmv: 88 }] })),
    "application/json"
  );
  assert.match(ok.text, /JSON 结构：\{report: string，rows: 数组\(2\)/);
  assert.deepEqual(ok.meta.headings, ["report", "rows"]);

  const broken = await read("bad.json", Buffer.from("{not json"), "application/json");
  assert.equal(broken.status, "READY", "解析失败仍是「读过这份文件」，只是拿不到结构");
  assert.ok(broken.note?.includes("JSON 解析失败"));
});

test("FI12 超长正文被截断时必须标记 truncated", async () => {
  const huge = "很长的一行内容。".repeat(Math.ceil(MAX_EXTRACTED_CHARS / 8) + 10);
  const result = await read("big.txt", Buffer.from(huge));
  assert.equal(result.status, "READY");
  assert.equal(result.truncated, true);
  assert.equal(result.text.length, MAX_EXTRACTED_CHARS);
  assert.ok(result.note?.includes("截断"), "截断这件事必须写进 note，否则上层会把节选当全文");
});

test("FI13 纯文本文件里的中文内容与换行不被吃掉", async () => {
  const result = await read("note.txt", Buffer.from("这是中文说明。\n第二行。\n"));
  assert.equal(result.status, "READY");
  assert.match(result.text, /这是中文说明。/);
  assert.equal(result.meta.rowCount, 3);
});

// ---------------------------------------------------------------------------
// 图片与视频：只读容器
// ---------------------------------------------------------------------------

test("FI14 图片只登记元信息，并如实说明画面内容未被读取", async () => {
  const result = await read("shot.png", minimalPng(800, 600), "image/png");
  assert.equal(result.status, "READY");
  assert.equal(result.meta.width, 800);
  assert.equal(result.meta.height, 600);
  assert.equal(result.meta.imageFormat, "PNG");
  assert.ok(result.note?.includes("画面内容未被读取"), "不得让调用方以为图片已经被看懂了");
});

test("FI15 非图片内容伪装成图片后缀时判 FAILED，而不是静默通过", async () => {
  const result = await read("fake.png", Buffer.from("这不是 PNG 而是一个文本文件。"), "image/png");
  assert.equal(result.status, "FAILED");
  assert.ok(result.note?.includes("不符合"));
});

test("FI16 视频：MP4 元数据可解析时给时长；容器读不了时是 UNSUPPORTED 而非 FAILED", async () => {
  const webm = await read("clip.webm", Buffer.from("1a45dfa3", "hex").subarray(0, 4), "video/webm");
  assert.equal(webm.status, "UNSUPPORTED", "WebM 只是这一层没能力解析，不是文件出错");
  assert.ok(webm.note?.includes("WebM"));

  const brokenMp4 = await read("broken.mp4", Buffer.from("ftypisom".padEnd(64, " ")), "video/mp4");
  assert.equal(brokenMp4.status, "UNSUPPORTED");
  assert.ok(brokenMp4.note?.includes("moov"), "应说明定位不到索引块");
});

test("FI17 空文件判 FAILED，并说明原因", async () => {
  const result = await read("empty.pdf", Buffer.alloc(0), "application/pdf");
  assert.equal(result.status, "FAILED");
  assert.ok(result.note?.includes("空"));
});
