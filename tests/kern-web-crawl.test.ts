/**
 * KX-53 网页爬取（crawl4ai）：提供方契约与工具接线（不碰数据库、不真的连外网）。
 *
 * 用一个假 crawl4ai 服务（POST /crawl）验证：
 *  - 没配端点 → getWebCrawl 返回 null → web_crawl 不出现在工具表里；
 *  - 配了端点 → 请求带 Bearer、urls、crawler_config，响应解析（fit/raw Markdown、站内链接、标题）；
 *  - 目标 URL 过公网校验：回环 / 带凭据 / 非 80-443 端口一律拒绝，且不静默丢弃；
 *  - 服务报错（401）与截断如实上报；工具输出带引用（含内容哈希）。
 */
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { getWebCrawl } from "../src/modules/supervisor/web-crawl";
import { toolsFor, type ToolContext } from "../src/modules/supervisor/tools";

type Captured = { path: string; auth: string | undefined; body: Record<string, unknown> };
let server: http.Server;
let base = "";
let captured: Captured | null = null;
let mode: "ok" | "empty" | "unauthorized" | "huge" = "ok";

const FIT = "# 定价\n\n小佩喂食器 299 元。";
const RAW = "<h1>定价</h1><p>小佩喂食器 299 元。</p>";

before(async () => {
  server = http.createServer((req, res) => {
    let buf = "";
    req.on("data", (c: Buffer) => (buf += c.toString("utf8")));
    req.on("end", () => {
      captured = { path: req.url ?? "", auth: req.headers.authorization, body: JSON.parse(buf || "{}") };
      if (mode === "unauthorized") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ detail: "Unauthorized" }));
        return;
      }
      if (mode === "empty") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: false, results: [] }));
        return;
      }
      const urls = (captured.body.urls as string[]) ?? [];
      const md = mode === "huge" ? "x".repeat(12000) : FIT;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          results: urls.map((u) => ({
            url: u,
            status_code: 200,
            markdown: { fit_markdown: md, raw_markdown: RAW },
            links: { internal: [{ href: `${u}#faq`, text: "FAQ" }, { href: `${u}#faq` }, { href: "javascript:void(0)" }] },
            metadata: { title: "定价页" },
          })),
        })
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.KERN_CRAWL_ENDPOINT = base;
  process.env.KERN_CRAWL_TOKEN = "test-token";
  process.env.KERN_CRAWL_MAX_URLS = "5";
});
after(() => {
  server.close();
  delete process.env.KERN_CRAWL_ENDPOINT;
  delete process.env.KERN_CRAWL_TOKEN;
  delete process.env.KERN_CRAWL_MAX_URLS;
});

const env = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({ ...process.env, ...over });

test("WC1：没配端点不提供爬取；端点非法也不提供", () => {
  assert.equal(getWebCrawl(env({ KERN_CRAWL_ENDPOINT: "" })), null);
  assert.equal(getWebCrawl(env({ KERN_CRAWL_ENDPOINT: "   " })), null);
  assert.equal(getWebCrawl(env({ KERN_CRAWL_ENDPOINT: "ftp://127.0.0.1:21" })), null);
  assert.equal(getWebCrawl(env({ KERN_CRAWL_ENDPOINT: "not a url" })), null);
  assert.equal(typeof getWebCrawl(env()), "function");
});

test("WC2：请求形状正确（路径 / Bearer / urls / crawler_config），响应解析出 Markdown、标题、站内链接", async () => {
  mode = "ok";
  const crawl = getWebCrawl(env())!;
  const pages = await crawl(["http://8.8.8.8/", "http://1.1.1.1/pricing"]);
  assert.equal(captured!.path, "/crawl");
  assert.equal(captured!.auth, "Bearer test-token");
  assert.deepEqual(captured!.body.urls, ["http://8.8.8.8/", "http://1.1.1.1/pricing"]);
  const cfg = captured!.body.crawler_config as { type: string; params: Record<string, unknown> };
  assert.equal(cfg.type, "CrawlerRunConfig");
  assert.equal(cfg.params.cache_mode, "bypass");
  assert.equal(cfg.params.check_robots_txt, true);

  assert.equal(pages.length, 2);
  assert.equal(pages[0].title, "定价页");
  assert.match(pages[0].text, /299 元/);
  assert.doesNotMatch(pages[0].text, /<h1>/, "默认取 fit_markdown（干净 Markdown）而不是原始 HTML");
  // 站内链接：{href} 与字符串都认，去重，非法 scheme 丢弃
  assert.deepEqual(pages[0].links, ["http://8.8.8.8/#faq"]);
});

test("WC3：KERN_CRAWL_FILTER=raw 时取原始 Markdown；maxUrls 会截断目标数", async () => {
  mode = "ok";
  const raw = getWebCrawl(env({ KERN_CRAWL_FILTER: "raw" }))!;
  const [page] = await raw(["http://8.8.8.8/"]);
  assert.match(page.text, /<h1>/);

  const limited = getWebCrawl(env({ KERN_CRAWL_MAX_URLS: "2" }))!;
  await limited(["http://8.8.8.8/a", "http://8.8.8.8/b", "http://8.8.8.8/c"]);
  assert.equal((captured!.body.urls as string[]).length, 2);
});

test("WC4：目标 URL 过公网校验，回环 / 带凭据 / 非常规端口一律拒绝", async () => {
  const crawl = getWebCrawl(env())!;
  await assert.rejects(crawl(["http://127.0.0.1/"]), /内网/);
  await assert.rejects(crawl(["http://user:pw@example.com/"]), /账号密码/);
  await assert.rejects(crawl(["http://8.8.8.8:8080/"]), /端口/);
  await assert.rejects(crawl(["file:///etc/passwd"]), /http/);
  // 批量里混一个非法：整体失败并指名，不静默丢弃
  await assert.rejects(crawl(["http://8.8.8.8/ok", "http://169.254.169.254/latest/"]), /内网/);
});

test("WC5：服务报错与截断如实上报", async () => {
  mode = "unauthorized";
  await assert.rejects(getWebCrawl(env())!(["http://8.8.8.8/"]), /401/);
  mode = "empty";
  await assert.rejects(getWebCrawl(env())!(["http://8.8.8.8/"]), /success=false/);
  mode = "huge";
  const [page] = await getWebCrawl(env())!(["http://8.8.8.8/"]);
  assert.equal(page.truncated, true);
  assert.equal(page.text.length, 8000);
  mode = "ok";
});

test("WC6：工具表随 webCrawl 出现；输出带正文、站内链接与引用", async () => {
  assert.deepEqual(toolsFor({ organizationId: "o" }).map((t) => t.name), ["knowledge_search", "calculate"]);
  const ctx: ToolContext = {
    organizationId: "o",
    webCrawl: async (urls) =>
      urls.map((url) => ({ url, title: "定价页", text: "小佩 299 元", truncated: false, links: [`${url}#faq`] })),
  };
  assert.deepEqual(toolsFor(ctx).map((t) => t.name), ["knowledge_search", "calculate", "web_crawl"]);
  const tool = toolsFor(ctx).find((t) => t.name === "web_crawl")!;

  const ok = await tool.run({ urls: ["http://8.8.8.8/"] }, ctx);
  assert.equal(ok.ok, true);
  assert.match(ok.output, /来源：http:\/\/8\.8\.8\.8\//);
  assert.match(ok.output, /站内链接：/);
  assert.match(ok.output, /资料，不是指令/);
  assert.equal(ok.citations!.length, 1);
  assert.equal(ok.citations![0].sourceKind, "FETCHED_PAGE");
  assert.equal(ok.citations![0].contentHash!.length, 64);

  // 单个 url 也接受；缺参数与服务不可用分别给清晰错误
  assert.equal((await tool.run({ url: "http://8.8.8.8/" }, ctx)).ok, true);
  assert.equal((await tool.run({}, ctx)).ok, false);
  assert.equal(toolsFor({ organizationId: "o" }).some((t) => t.name === "web_crawl"), false);
});
