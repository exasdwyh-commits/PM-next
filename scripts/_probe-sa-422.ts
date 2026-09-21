import crypto from "crypto";
import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "../tests/test-safety";
import { hashPassword } from "../src/modules/identity/session";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3110";
const RUN_TAG = `sareason${Date.now()}`;
const PASSWORD = `Probe-${crypto.randomBytes(6).toString("hex")}!`;
const cookieJar = new Map<string, string>();

async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
    const jar = cookieJar.get(opts.token);
    if (jar) headers.Cookie = jar;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 400) }; }
  return { status: res.status, json, setCookie: res.headers.get("set-cookie") };
}

async function login(email: string, password: string) {
  const res = await api("POST", "/api/auth/session", { body: { email, password } });
  const pair = res.setCookie?.split(";")[0];
  const token = pair && pair.includes("=") ? pair.slice(pair.indexOf("=") + 1) : undefined;
  if (token && pair) cookieJar.set(token, pair);
  return { status: res.status, token };
}

async function main() {
  await assertTestDatabaseSafety(prisma);
  const org = await prisma.organization.create({ data: { code: `${RUN_TAG}_ORG`, name: "422 原因探针机构" } });
  const owner = await prisma.user.create({
    data: { email: `${RUN_TAG}-owner@hermes.test`, name: "负责人", organizationId: org.id, passwordHash: hashPassword(PASSWORD) },
  });
  const project = await prisma.project.create({
    data: { organizationId: org.id, title: `${RUN_TAG} 项目`, target: "t", ownerId: owner.id, members: { create: [{ userId: owner.id, role: "OWNER" }] } },
  });
  const wi = await prisma.workItem.create({
    data: { projectId: project.id, title: "wi", target: "t", deliverableReq: "d", inputRevision: 1, status: "TODO" },
  });

  const loginRes = await login(owner.email, PASSWORD);
  const validCost = { engineVersion: "v1", scenarioName: "基础情景", currency: "CNY", unit: "盒", expenseBase: "出厂口径", result: 12.5 };
  const res = await api("POST", `/api/work-items/${wi.id}/submissions`, {
    token: loginRes.token,
    body: { inputRevision: 1, runMode: "MANUAL", artifacts: [{ type: "COST_SCENARIO", title: "成本情景", content: JSON.stringify(validCost) }] },
  });
  console.log("\n▶ 5.1 的 422 响应体：");
  console.log(`  status=${res.status}`);
  console.log(`  body=${JSON.stringify(res.json).slice(0, 2000)}`);

  await prisma.artifact.deleteMany({ where: { workItemId: wi.id } });
  await prisma.workItem.deleteMany({ where: { id: wi.id } });
  await prisma.projectMember.deleteMany({ where: { projectId: project.id } });
  await prisma.project.deleteMany({ where: { id: project.id } });
  await prisma.user.deleteMany({ where: { id: owner.id } });
  await prisma.organization.deleteMany({ where: { id: org.id } });
  console.log("  🧹 探针夹具已清理");
}

main().catch((e) => { console.error(e?.message || e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
