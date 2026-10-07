/**
 * KX-30 凭证保管层 · 纯函数部分（不碰数据库，便于单测）
 * ======================================================
 *
 * - AES-256-GCM，每条凭证随机 12 字节 IV；密文格式 `v1.<keyVersion>.<iv>.<tag>.<ciphertext>`（base64url）。
 * - 密钥来自 KERN_VAULT_KEY（32 字节，base64 或 hex）。生产环境必须配置；
 *   开发 / 测试环境缺省时用固定派生的开发密钥（keyVersion 0），并在列表里标明。
 * - 一条凭证 = 一个目标（域名或连接器 id）下的一组 header；值只在服务端注入时解密，永不回显。
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const VAULT_LIMITS = { maxHeaders: 8, maxValueChars: 4096, maxLabelChars: 60, maxTtlSeconds: 90 * 24 * 3600 };

export type VaultKey = { key: Buffer; version: number };

export class VaultConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultConfigError";
  }
}

export function loadVaultKey(env: Record<string, string | undefined> = process.env): VaultKey {
  const raw = env.KERN_VAULT_KEY?.trim();
  if (raw) {
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (buf.length !== 32) throw new VaultConfigError("KERN_VAULT_KEY 必须是 32 字节（64 位 hex 或 base64）");
    const version = Number(env.KERN_VAULT_KEY_VERSION ?? "1");
    return { key: buf, version: Number.isInteger(version) && version > 0 ? version : 1 };
  }
  if (env.NODE_ENV === "production") throw new VaultConfigError("生产环境未配置 KERN_VAULT_KEY，凭证保管层不可用");
  return { key: createHash("sha256").update("kern-dev-vault:v0").digest(), version: 0 };
}

const b64 = (b: Buffer) => b.toString("base64url");

export function encryptSecret(plain: string, k: VaultKey, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k.key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", String(k.version), b64(iv), b64(c.getAuthTag()), b64(ct)].join(".");
}

export function decryptSecret(blob: string, k: VaultKey, aad: string): string {
  const [v, ver, iv, tag, ct] = blob.split(".");
  if (v !== "v1" || ct === undefined) throw new VaultConfigError("无法识别的凭证密文格式");
  if (Number(ver) !== k.version) throw new VaultConfigError(`凭证用密钥版本 ${ver} 加密，当前是 ${k.version}`);
  const d = createDecipheriv("aes-256-gcm", k.key, Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

export type HeaderPair = { name: string; value: string };

/** 目标：域名（api.example.com / *.example.com）或连接器 id（connector:xxx）。 */
export function normalizeTarget(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (/^connector:[a-z0-9][a-z0-9._-]{0,62}$/.test(t)) return t;
  if (/^(\*\.)?([a-z0-9-]{1,63}\.)+[a-z]{2,63}(:\d{1,5})?$/.test(t)) return t;
  return null;
}

/** 返回错误信息；null 表示合法。 */
export function validateHeaders(headers: HeaderPair[]): string | null {
  if (!Array.isArray(headers) || headers.length === 0) return "至少需要一个 header";
  if (headers.length > VAULT_LIMITS.maxHeaders) return `最多 ${VAULT_LIMITS.maxHeaders} 个 header`;
  const seen = new Set<string>();
  for (const h of headers) {
    if (!h || typeof h.name !== "string" || typeof h.value !== "string") return "header 格式不对";
    const name = h.name.trim();
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/.test(name)) return `header 名不合法：${name.slice(0, 20)}`;
    if (/^(host|content-length|transfer-encoding|connection|cookie2)$/i.test(name)) return `不允许保管 ${name}`;
    if (seen.has(name.toLowerCase())) return `header 重复：${name}`;
    seen.add(name.toLowerCase());
    if (!h.value || h.value.length > VAULT_LIMITS.maxValueChars) return `${name} 的值为空或过长`;
    if (/[\r\n\0]/.test(h.value)) return `${name} 的值包含换行`;
  }
  return null;
}

/** 展示用提示：只有 header 名和值的末 4 位，例如 `Authorization ••••1a2b`。 */
export function headerHint(headers: HeaderPair[]): string {
  return headers.map((h) => `${h.name.trim()} ••••${h.value.length >= 12 ? h.value.slice(-4) : ""}`).join("，");
}

export type CredentialState = { revokedAt: Date | null; expiresAt: Date | null; oneTime: boolean; usedAt: Date | null };
export type CredentialStatus = "ACTIVE" | "EXPIRED" | "USED" | "REVOKED";

export function credentialStatus(c: CredentialState, now = new Date()): CredentialStatus {
  if (c.revokedAt) return "REVOKED";
  if (c.oneTime && c.usedAt) return "USED";
  if (c.expiresAt && c.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  return "ACTIVE";
}

/** 目标匹配：精确域名、通配子域（*.example.com 不含裸域）、或连接器 id。 */
export function targetMatches(target: string, host: string): boolean {
  const h = host.toLowerCase();
  if (target === h) return true;
  if (target.startsWith("*.")) return h.endsWith(target.slice(1)) && h.length > target.length - 1;
  return false;
}

/**
 * 不回显：把文本里出现的凭证值（及其常见变体）替换掉。
 * 用于工具输出、错误信息、日志——凭证注入后，响应里可能回显 token。
 */
export function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  const variants = new Set<string>();
  for (const s of secrets) {
    if (!s || s.length < 6) continue;
    variants.add(s);
    const bare = s.replace(/^(Bearer|Basic|Token)\s+/i, "");
    if (bare.length >= 6) variants.add(bare);
    variants.add(encodeURIComponent(bare));
  }
  for (const v of [...variants].sort((a, b) => b.length - a.length)) out = out.split(v).join("[凭证已隐藏]");
  return out;
}
