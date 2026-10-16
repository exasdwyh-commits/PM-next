/**
 * 跨上下文安全的 UUID 生成。
 *
 * 浏览器只在**安全上下文**（HTTPS 或 localhost）下暴露 `crypto.randomUUID()`。
 * 一旦通过局域网 IP 或内网 HTTP 域名访问（如 `http://192.168.1.20:3100`），
 * `window.crypto` 仍在、`randomUUID` 却是 undefined，直接调用会抛
 * `TypeError: crypto.randomUUID is not a function`，把整个「发送消息」打断。
 * 这里按能力探测逐级降级：randomUUID → getRandomValues → Math.random。
 */
export function createUuid(): string {
  const webCrypto: Crypto | undefined = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  // 按 RFC 4122 v4 打上版本位与变体位，保证下游按 UUID 格式解析时不挑食。
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
