import assert from "node:assert/strict";
import { test } from "node:test";
import {
  credentialStatus,
  decryptSecret,
  encryptSecret,
  headerHint,
  loadVaultKey,
  normalizeTarget,
  redactSecrets,
  targetMatches,
  validateHeaders,
} from "../src/modules/vault/crypto";

const K = loadVaultKey({ KERN_VAULT_KEY: "11".repeat(32), NODE_ENV: "test" });

test("VT1：加解密往返；密文不含明文；绑定 AAD（换用户 / 换目标都解不开）", () => {
  const blob = encryptSecret("Bearer sk-live-abcdef123456", K, "u1|api.x.com|c1");
  assert.match(blob, /^v1\.1\./);
  assert.doesNotMatch(blob, /sk-live/);
  assert.equal(decryptSecret(blob, K, "u1|api.x.com|c1"), "Bearer sk-live-abcdef123456");
  assert.throws(() => decryptSecret(blob, K, "u2|api.x.com|c1"));
  assert.throws(() => decryptSecret(blob, loadVaultKey({ KERN_VAULT_KEY: "22".repeat(32) }), "u1|api.x.com|c1"));
  assert.notEqual(encryptSecret("same", K, "a"), encryptSecret("same", K, "a"), "每次随机 IV");
});

test("VT2：密钥配置——生产必须配置；长度校验；开发回退为版本 0", () => {
  assert.throws(() => loadVaultKey({ NODE_ENV: "production" }), /KERN_VAULT_KEY/);
  assert.throws(() => loadVaultKey({ KERN_VAULT_KEY: "abcd" }), /32 字节/);
  assert.equal(loadVaultKey({ NODE_ENV: "development" }).version, 0);
  assert.equal(loadVaultKey({ KERN_VAULT_KEY: Buffer.alloc(32, 7).toString("base64"), KERN_VAULT_KEY_VERSION: "3" }).version, 3);
});

test("VT3：目标与 header 校验", () => {
  assert.equal(normalizeTarget("https://API.Example.com/v1/x"), "api.example.com");
  assert.equal(normalizeTarget("*.example.com"), "*.example.com");
  assert.equal(normalizeTarget("connector:notion"), "connector:notion");
  assert.equal(normalizeTarget("localhost"), null);
  assert.equal(normalizeTarget("not a host"), null);
  assert.equal(validateHeaders([{ name: "Authorization", value: "Bearer x" }, { name: "X-Api-Key", value: "k" }]), null);
  assert.match(validateHeaders([])!, /至少/);
  assert.match(validateHeaders([{ name: "Host", value: "x" }])!, /不允许/);
  assert.match(validateHeaders([{ name: "A", value: "x\r\nB: y" }])!, /换行/);
  assert.match(validateHeaders([{ name: "a", value: "1" }, { name: "A", value: "2" }])!, /重复/);
  assert.match(validateHeaders([{ name: "bad name", value: "1" }])!, /不合法/);
});

test("VT4：状态——过期 / 一次性用过 / 撤销优先", () => {
  const now = new Date("2026-09-28T00:00:00Z");
  const base = { revokedAt: null, expiresAt: null, oneTime: false, usedAt: null };
  assert.equal(credentialStatus(base, now), "ACTIVE");
  assert.equal(credentialStatus({ ...base, expiresAt: new Date("2026-09-27T23:59:59Z") }, now), "EXPIRED");
  assert.equal(credentialStatus({ ...base, expiresAt: new Date("2026-09-28T00:00:01Z") }, now), "ACTIVE");
  assert.equal(credentialStatus({ ...base, oneTime: true, usedAt: now }, now), "USED");
  assert.equal(credentialStatus({ ...base, oneTime: false, usedAt: now }, now), "ACTIVE");
  assert.equal(credentialStatus({ ...base, revokedAt: now, oneTime: true, usedAt: now }, now), "REVOKED");
});

test("VT5：目标匹配不越界", () => {
  assert.ok(targetMatches("api.x.com", "API.x.com"));
  assert.ok(targetMatches("*.x.com", "a.b.x.com"));
  assert.ok(!targetMatches("*.x.com", "x.com"));
  assert.ok(!targetMatches("*.x.com", "evilx.com"));
  assert.ok(!targetMatches("api.x.com", "api.x.com.evil.io"));
});

test("VT6：不回显——提示只含末 4 位；输出里的凭证值（含去前缀、URL 编码）被替换", () => {
  const hint = headerHint([{ name: "Authorization", value: "Bearer sk-live-abcdef123456" }, { name: "X-Short", value: "abc" }]);
  assert.equal(hint, "Authorization ••••3456，X-Short ••••");
  assert.doesNotMatch(hint, /sk-live/);
  const out = redactSecrets('{"echo":"Bearer sk-live-abc/def+1"} token=sk-live-abc%2Fdef%2B1 raw sk-live-abc/def+1', ["Bearer sk-live-abc/def+1", "abc"]);
  assert.doesNotMatch(out, /sk-live/);
  assert.match(out, /\[凭证已隐藏\]/);
  assert.match(out, /echo/, "过短的值（<6）不替换，避免误伤正常文本");
});
