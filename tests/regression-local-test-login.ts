import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { POST, GET, DELETE } from "../src/app/api/auth/session/route";
import { LOCAL_TEST_EMAIL, LOCAL_TEST_ORG, localTestLoginEnabled, localTestRequestAllowed } from "../src/modules/identity/local-test-policy";
import { hashToken } from "../src/modules/identity/session";

async function main() {
  await assertTestDatabaseSafety(prisma);
  const previous = { node: process.env.NODE_ENV, enabled: process.env.KERN_LOCAL_TEST_LOGIN };
  let orgId: string | undefined;
  const setMode = (mode: string, enabled: string) => {
    Object.assign(process.env, { NODE_ENV: mode, KERN_LOCAL_TEST_LOGIN: enabled });
  };
  const request = (host = "127.0.0.1:3100", origin = "http://127.0.0.1:3100") => new NextRequest("http://127.0.0.1:3100/api/auth/session", {
    method: "POST", headers: { host, origin, "content-type": "application/json" },
    body: JSON.stringify({ localTest: true }),
  });
  try {
    // Never reuse or erase a pre-existing account in this isolated database.
    assert.equal(await prisma.organization.count({ where: { code: LOCAL_TEST_ORG } }), 0);
    assert.equal(await prisma.user.count({ where: { email: LOCAL_TEST_EMAIL } }), 0);
    const org = await prisma.organization.create({ data: { code: LOCAL_TEST_ORG, name: "Login regression" } });
    orgId = org.id;
    const user = await prisma.user.create({ data: { email: LOCAL_TEST_EMAIL, name: "Test", organizationId: org.id } });
    for (const mode of ["production", "test"]) {
      setMode(mode, "true");
      assert.equal(localTestLoginEnabled("127.0.0.1:3100"), false);
      assert.equal((await POST(request())).status, 403);
    }
    setMode("development", "false");
    assert.equal((await POST(request())).status, 403);
    setMode("development", "true");
    // 非内网来源一律拒绝（局域网免密只放行回环与私有网段）。
    for (const host of ["example.com", "127.0.0.1.example.com", "localhost@evil.test", "8.8.8.8", "172.32.1.1", "169.254.1.1", "192.169.1.1"]) {
      assert.equal(localTestLoginEnabled(host), false);
      assert.equal((await POST(request(host))).status, 403);
    }
    // Host 头形状不合法必须拒绝 —— 这些形态会被 URL 归一成"看似内网"，必须先校验形状。
    for (const host of ["127.0.0.1:3100/path", "127.0.0.1:70000", "127.0.0.999", "127.0.0.1,127.0.0.2", "user@127.0.0.1"]) {
      assert.equal(localTestLoginEnabled(host), false);
      assert.equal((await POST(request(host))).status, 403);
    }
    // 局域网免密（设计上允许）：回环整段（含 127.0.0.2）与 RFC1918 私有段放行。
    for (const host of ["127.0.0.2:3100", "10.0.0.7", "172.16.3.9:3100", "192.168.1.20", "localhost:3100"]) {
      assert.equal(localTestLoginEnabled(host), true);
    }
    assert.equal((await POST(request("127.0.0.1:3100", "http://evil.test"))).status, 403);
    assert.equal((await POST(request("127.0.0.1:3100", ""))).status, 403);
    const crossSite = request();
    crossSite.headers.set("sec-fetch-site", "cross-site");
    assert.equal(localTestRequestAllowed(crossSite.headers), false);
    assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0);

    const response = await POST(request());
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.token, undefined);
    const cookie = response.cookies.get("hermes_session_token")!;
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, "lax");
    assert.equal(cookie.secure, false);
    const row = await prisma.session.findUniqueOrThrow({ where: { tokenHash: hashToken(cookie.value) } });
    assert.ok(Math.abs(row.expiresAt.getTime() - Date.now() - 30 * 86400000) < 10000);
    const authenticated = () => new NextRequest("http://127.0.0.1:3100/api/auth/session", { headers: { cookie: `hermes_session_token=${cookie.value}` } });
    assert.equal((await GET(authenticated())).status, 200);
    // Restarting without the test feature retains the normal authenticated session.
    setMode("development", "false");
    assert.equal((await GET(authenticated())).status, 200);
    assert.equal((await DELETE(authenticated())).status, 200);
    assert.equal((await GET(authenticated())).status, 401);

    setMode("development", "true");
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    assert.equal((await POST(request())).status, 403);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: true, isSystem: true } });
    assert.equal((await POST(request())).status, 403);
    console.log("Local test login passed: disabled outside local development, 30-day session, cookie auth and logout.");
  } finally {
    Object.assign(process.env, { NODE_ENV: previous.node });
    if (previous.enabled === undefined) delete process.env.KERN_LOCAL_TEST_LOGIN;
    else process.env.KERN_LOCAL_TEST_LOGIN = previous.enabled;
    if (orgId) await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
