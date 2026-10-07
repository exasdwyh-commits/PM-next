/**
 * KX-30 凭证保管层 — DB 回归。
 * - 录入后列表不含明文 / 密文；DB 里的 cipher 不含明文；
 * - 目标匹配才注入，跨目标拒绝并写审计；
 * - 一次性凭证在并发下只能被用一次；过期凭证不可用；撤销后清空密文；
 * - 他人无法撤销；每次使用都有 credential.use 审计。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { createCredential, listCredentials, redactSecrets, revokeCredential, injectCredential } from "../src/modules/vault";

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const org = await prisma.organization.create({ data: { name: "Vault", code: "VLT_" + tag } });
  const user = await prisma.user.create({ data: { organizationId: org.id, email: `vlt-${tag}@hermes.test`, name: "V" } });
  const other = await prisma.user.create({ data: { organizationId: org.id, email: `vlt2-${tag}@hermes.test`, name: "V2" } });
  const me = { organizationId: org.id, userId: user.id };
  const them = { organizationId: org.id, userId: other.id };
  const SECRET = "Bearer sk-test-" + tag;

  try {
    console.log("▶ VD1 录入：列表只有提示，DB 密文不含明文");
    const c = await createCredential(me, { target: "https://api.vault-test.example/v1", label: "测试", headers: [{ name: "Authorization", value: SECRET }] });
    assert.equal(c.target, "api.vault-test.example");
    const listed = JSON.stringify(await listCredentials(me));
    assert.ok(!listed.includes(tag), "列表不得包含凭证值");
    assert.ok(!listed.includes("cipher"));
    const row = await prisma.kernCredential.findUniqueOrThrow({ where: { id: c.id } });
    assert.ok(!row.cipher.includes(tag));
    assert.deepEqual(await listCredentials(them), []);

    console.log("▶ VD2 目标匹配才注入；跨目标拒绝并审计");
    const use = await injectCredential(me, { host: "api.vault-test.example", purpose: "回归测试" });
    assert.equal(use?.headers.Authorization, SECRET);
    assert.ok(!redactSecrets(`echo ${SECRET}`, use!.secrets).includes(tag));
    assert.equal(await injectCredential(me, { host: "evil.example", purpose: "越界", credentialId: c.id }), null);
    assert.equal(await injectCredential(them, { host: "api.vault-test.example", purpose: "他人" }), null);
    await assert.rejects(injectCredential(me, { host: "api.vault-test.example", purpose: "  " }));

    console.log("▶ VD3 一次性凭证并发只成功一次");
    const once = await createCredential(me, { target: "once.vault-test.example", headers: [{ name: "X-Api-Key", value: "once-" + tag }], oneTime: true });
    const results = await Promise.all(Array.from({ length: 5 }, () => injectCredential(me, { host: "once.vault-test.example", purpose: "并发" })));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await listCredentials(me)).find((x) => x.id === once.id)?.status, "USED");

    console.log("▶ VD4 过期不可用");
    const exp = await createCredential(me, { target: "exp.vault-test.example", headers: [{ name: "X-Api-Key", value: "exp-" + tag }], ttlSeconds: 60 });
    await prisma.kernCredential.update({ where: { id: exp.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await injectCredential(me, { host: "exp.vault-test.example", purpose: "过期" }), null);
    assert.equal((await listCredentials(me)).find((x) => x.id === exp.id)?.status, "EXPIRED");

    console.log("▶ VD5 撤销：他人不可；本人撤销后清空密文、不可再用");
    assert.equal(await revokeCredential(them, c.id), false);
    assert.equal(await revokeCredential(me, c.id), true);
    assert.equal((await prisma.kernCredential.findUniqueOrThrow({ where: { id: c.id } })).cipher, "");
    assert.equal(await injectCredential(me, { host: "api.vault-test.example", purpose: "撤销后" }), null);

    console.log("▶ VD6 审计齐全且不含凭证值");
    const audits = await prisma.auditEvent.findMany({ where: { actorId: user.id, objectType: "KernCredential" } });
    const actions = audits.map((a) => a.action);
    for (const a of ["credential.create", "credential.use", "credential.deny", "credential.revoke"]) assert.ok(actions.includes(a), `缺少审计 ${a}`);
    assert.equal(actions.filter((a) => a === "credential.use").length, 2);
    assert.ok(!JSON.stringify(audits).includes(tag), "审计里不得出现凭证值");

    console.log("\n✅ Kern vault regression passed");
  } finally {
    await prisma.auditEvent.deleteMany({ where: { actorId: { in: [user.id, other.id] } } });
    await prisma.kernCredential.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
