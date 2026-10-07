/**
 * KX-52 出站安全抓取（SSRF 防护）
 * ================================
 *
 * 模型可以让 Kern 抓取任意 URL，所以每一跳都要校验：
 *  - 只允许 http / https，URL 里不能带账号密码；端口仅 80 / 443（或显式放行）。
 *  - DNS 解析出的每个地址都不能是内网、回环、链路本地、CGNAT、组播、云元数据等保留段（含 IPv4 映射的 IPv6）。
 *  - 连接时把 socket 钉在已校验的 IP 上（自定义 lookup），防 DNS rebinding。
 *  - 手动跟随重定向（最多 3 跳），每一跳重新校验。
 *  - 超时 8 秒，正文最多 1 MB，只接受文本类 content-type。
 */
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, p) => (acc << 8) + Number(p), 0) >>> 0;
}

function v4Blocked(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

/** 地址是否属于禁止出站的保留段。 */
export function isBlockedAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return v4Blocked(ip);
  if (family !== 6) return true;
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  // IPv4 映射 / 兼容地址：::ffff:10.0.0.1、::ffff:a00:1
  const mapped = /^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return v4Blocked(mapped[1]);
  const hexMapped = /^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return v4Blocked(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (lower === "::" || lower === "::1") return true;
  const first = parseInt(lower.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 唯一本地
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 链路本地
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 组播
  if (first === 0x2001 && parseInt(lower.split(":")[1] || "0", 16) === 0x0db8) return true; // 文档段
  if (first === 0x64 && lower.startsWith("64:ff9b:")) return true; // NAT64 可绕到内网
  return false;
}

export interface SafeFetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** 仅测试用：放行的 host:port（例如本机测试服务器）。 */
  allowHosts?: string[];
  /** 仅测试用：替换 DNS。 */
  resolve?: (host: string) => Promise<string[]>;
  /** KX-31：MCP 连接器需要 POST JSON-RPC。POST 不跟随重定向。 */
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
  /** 响应头（小写键）；MCP 需要读取 mcp-session-id。 */
  headers?: Record<string, string>;
}

/** 校验 URL 本身（不含 DNS）。返回规范化后的 URL。 */
export function validateUrlShape(raw: string, allowHosts: string[] = []): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError("不是合法的网址");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UnsafeUrlError("只允许 http / https");
  if (u.username || u.password) throw new UnsafeUrlError("网址不能包含账号密码");
  const hostPort = `${u.hostname}:${u.port || (u.protocol === "https:" ? "443" : "80")}`;
  if (allowHosts.includes(hostPort)) return u;
  if (u.port && u.port !== "80" && u.port !== "443") throw new UnsafeUrlError("只允许 80 / 443 端口");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new UnsafeUrlError("不允许访问内网主机名");
  }
  if (net.isIP(host) && isBlockedAddress(host)) throw new UnsafeUrlError("不允许访问内网地址");
  return u;
}

async function resolveSafe(u: URL, opts: SafeFetchOptions): Promise<string> {
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const hostPort = `${u.hostname}:${u.port || (u.protocol === "https:" ? "443" : "80")}`;
  const allowed = (opts.allowHosts ?? []).includes(hostPort);
  if (net.isIP(host)) return host;
  const addrs = opts.resolve
    ? await opts.resolve(host)
    : (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);
  if (!addrs.length) throw new UnsafeUrlError("域名解析失败");
  if (!allowed && addrs.some(isBlockedAddress)) throw new UnsafeUrlError("域名解析到了内网地址");
  return addrs[0];
}

/** Public target validation for remote readers; their redirect/connection handling is upstream. */
export async function validatePublicUrl(raw: string): Promise<URL> {
  const url = validateUrlShape(raw);
  await resolveSafe(url, {});
  return url;
}

function requestOnce(
  u: URL,
  ip: string,
  opts: Required<Pick<SafeFetchOptions, "timeoutMs" | "maxBytes">> & Pick<SafeFetchOptions, "method" | "body" | "headers" | "signal">
) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; truncated: boolean }>((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      u,
      {
        method: opts.method ?? "GET",
        headers: {
          "user-agent": "KernBot/1.0 (+research; read-only)",
          accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.1",
          ...(opts.headers ?? {}),
          ...(opts.body !== undefined ? { "content-length": String(Buffer.byteLength(opts.body)) } : {}),
        },
        // 钉死已校验的 IP：连接时不再二次解析，杜绝 DNS rebinding。
        lookup: (_h: string, o: unknown, cb: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void) => {
          const family = net.isIP(ip);
          if ((o as { all?: boolean } | undefined)?.all) cb(null, [{ address: ip, family }]);
          else cb(null, ip, family);
        },
        timeout: opts.timeoutMs,
        signal: opts.signal,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on("data", (c: Buffer) => {
          if (truncated) return;
          size += c.length;
          if (size > opts.maxBytes) {
            chunks.push(c.subarray(0, c.length - (size - opts.maxBytes)));
            truncated = true;
            res.destroy();
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8"), truncated });
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8"), truncated }));
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error("抓取超时")));
    req.on("error", reject);
    req.end(opts.body);
  });
}

export async function safeFetch(raw: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const maxBytes = options.maxBytes ?? 1_000_000;
  const maxRedirects = options.maxRedirects ?? 3;
  let current = raw;
  for (let hop = 0; ; hop += 1) {
    options.signal?.throwIfAborted();
    const u = validateUrlShape(current, options.allowHosts);
    const ip = await resolveSafe(u, options);
    options.signal?.throwIfAborted();
    const r = await requestOnce(u, ip, { signal: options.signal, timeoutMs, maxBytes, method: options.method ?? "GET", body: options.body, headers: options.headers });
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      if (options.method === "POST") throw new UnsafeUrlError("POST 请求不跟随重定向");
      if (hop >= maxRedirects) throw new UnsafeUrlError("重定向次数过多");
      current = new URL(r.headers.location, u).toString();
      continue;
    }
    const contentType = String(r.headers["content-type"] ?? "");
    if (contentType && !/text\/|json|xml/i.test(contentType)) throw new UnsafeUrlError(`不支持的内容类型：${contentType.split(";")[0]}`);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.headers)) if (typeof v === "string") headers[k.toLowerCase()] = v;
    return { url: u.toString(), status: r.status, contentType, body: r.body, truncated: r.truncated, headers };
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** 粗粒度 HTML → 纯文本：去脚本样式与标签，保留段落换行。 */
export function htmlToText(html: string): { title: string | null; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  const text = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: title ? htmlToText(title).text : null, text };
}
