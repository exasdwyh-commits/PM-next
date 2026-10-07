import { validatePublicUrl } from "@/shared/net/safe-fetch";

const MAX_BYTES = 1_000_000;

/** Fixed official endpoint; never include provider response bodies or credentials in errors. */
export async function requestMetaso(path: "search" | "reader", key: string, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(30_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(`https://metaso.cn/api/v1/${path}`, {
    method: "POST", redirect: "error", signal: combined,
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`秘塔服务返回 ${response.status}`); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("秘塔服务返回空响应");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("秘塔响应超过大小限制");
      chunks.push(part.value);
    }
  } finally { await reader.cancel(); }
  let data: unknown;
  try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("秘塔服务返回无效 JSON"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("秘塔响应格式无效");
  const result = data as Record<string, unknown>;
  if (result.error || (result.errCode !== undefined && result.errCode !== 0)) throw new Error("秘塔服务未完成请求");
  return result;
}

/** Validate the requested public URL before sending it to the remote reader. */
export function getMetasoReader(env: NodeJS.ProcessEnv = process.env) {
  const key = env.METASO_READER_API_KEY || env.METASO_API_KEY;
  if (env.KERN_READER_PROVIDER !== "metaso" || !key) return null;
  return async (raw: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const url = (await validatePublicUrl(raw)).toString();
    const data = await requestMetaso("reader", key, { url, format: "markdown" }, signal);
    if (typeof data.markdown !== "string" || !data.markdown.trim()) throw new Error("秘塔未返回网页正文");
    // The provider may return a final redirect URL; it must also be public.
    const finalUrl = typeof data.url === "string" ? (await validatePublicUrl(data.url)).toString() : url;
    return { url: finalUrl, title: typeof data.title === "string" ? data.title.slice(0, 200) : null,
      text: data.markdown.slice(0, 100_000), truncated: data.markdown.length > 100_000 };
  };
}
