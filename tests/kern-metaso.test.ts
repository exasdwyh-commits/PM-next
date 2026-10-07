import assert from "node:assert/strict";
import { test } from "node:test";
import { getWebSearch } from "../src/modules/supervisor/web-search";
import { getMetasoReader, requestMetaso } from "../src/modules/supervisor/metaso";

test("秘塔搜索按真实 webpages/link 格式映射，限制条数并过滤非法链接", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://metaso.cn/api/v1/search");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-key");
    assert.deepEqual(JSON.parse(String(init?.body)), { q: "任务状态", scope: "webpage", size: 3, includeSummary: true });
    return Response.json({ webpages: [
      { title: "官方", link: "https://example.com/", snippet: "执行  状态" },
      { link: "javascript:alert(1)" }, { link: "https://user:password@example.com/" },
      { title: "超出数量", link: "https://example.com/extra" },
    ] });
  };
  try {
    const search = getWebSearch({ NODE_ENV: "test", KERN_SEARCH_PROVIDER: "metaso", METASO_SEARCH_API_KEY: "test-key" })!;
    assert.deepEqual(await search("任务状态", 3), [{ title: "官方", url: "https://example.com/", snippet: "执行 状态" }]);
    assert.equal(getWebSearch({ NODE_ENV: "test", KERN_SEARCH_PROVIDER: "metaso" }), null);
  } finally { globalThis.fetch = original; }
});

test("秘塔异常与非标准响应不能被当作空检索成功；错误不暴露服务响应", async () => {
  const original = globalThis.fetch;
  try {
    const search = getWebSearch({ NODE_ENV: "test", KERN_SEARCH_PROVIDER: "metaso", METASO_API_KEY: "test-key" })!;
    for (const response of [Response.json({ errCode: 401, message: "secret-test-key" }), Response.json({ unexpected: [] }), new Response("not JSON"), new Response("secret-test-key", { status: 429 })]) {
      globalThis.fetch = async () => response;
      await assert.rejects(search("x", 1), error => error instanceof Error && !error.message.includes("secret-test-key"));
    }
    globalThis.fetch = async () => new Response("x".repeat(1_000_001));
    await assert.rejects(requestMetaso("search", "test-key", {}), /大小限制/);
    const abort = new AbortController(); abort.abort();
    globalThis.fetch = async () => { assert.fail("Aborted request must not call provider"); };
    await assert.rejects(search("x", 1, abort.signal), { name: "AbortError" });
  } finally { globalThis.fetch = original; }
});

test("秘塔 reader 拒绝内网地址且不向第三方发送请求", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { assert.fail("Private URL must not reach remote reader"); };
  try {
    const reader = getMetasoReader({ NODE_ENV: "test", KERN_READER_PROVIDER: "metaso", METASO_READER_API_KEY: "test-key" })!;
    for (const url of ["http://localhost/", "http://169.254.169.254/", "http://[::1]/", "https://user:pw@example.com/"]) await assert.rejects(reader(url));
    assert.equal(getMetasoReader({ NODE_ENV: "test", METASO_API_KEY: "test-key" }), null);
  } finally { globalThis.fetch = original; }
});

test("秘塔 reader 读取 Markdown、保留正文，并拒绝私有重定向结果和空正文", async () => {
  const original = globalThis.fetch;
  try {
    const reader = getMetasoReader({ NODE_ENV: "test", KERN_READER_PROVIDER: "metaso", METASO_API_KEY: "test-key" })!;
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://metaso.cn/api/v1/reader");
      assert.deepEqual(JSON.parse(String(init?.body)), { url: "https://8.8.8.8/", format: "markdown" });
      return Response.json({ url: "https://8.8.8.8/", title: "公开页", markdown: "# 标题\n事实段落" });
    };
    assert.deepEqual(await reader("https://8.8.8.8/"), { url: "https://8.8.8.8/", title: "公开页", text: "# 标题\n事实段落", truncated: false });
    globalThis.fetch = async () => Response.json({ url: "http://localhost/", markdown: "private content" });
    await assert.rejects(reader("https://8.8.8.8/"), /内网/);
    globalThis.fetch = async () => Response.json({ markdown: " " });
    await assert.rejects(reader("https://8.8.8.8/"), /正文/);
  } finally { globalThis.fetch = original; }
});
