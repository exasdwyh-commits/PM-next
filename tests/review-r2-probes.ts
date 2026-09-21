import { testPrisma, assertTestDatabaseSafety } from "./test-safety";
import { NextRequest } from "next/server";
import { POST as login } from "../src/app/api/auth/session/route";
import { createProject, updateProject } from "../src/modules/projects/service";
import { createDecisionPacketDraft, submitDecisionPacket, decideDecisionPacket } from "../src/modules/decisions/service";
import { synthesizeMarketResearch } from "../src/modules/research/market-research";
import { parseProjectRequirements } from "../src/modules/research/requirement-parser";
import prisma from "../src/shared/db";

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(testPrisma);
  await assertTestDatabaseSafety(prisma);

  const org = await testPrisma.organization.upsert({
    where: { code: "R2_PROBE_ORG" },
    update: {},
    create: { name: "R2 诊断机构", code: "R2_PROBE_ORG" },
  });

  const owner = await testPrisma.user.upsert({
    where: { email: "r2_pm@hermes.test" },
    update: { organizationId: org.id },
    create: { organizationId: org.id, name: "R2张主管", email: "r2_pm@hermes.test" },
  });

  const leader = await testPrisma.user.upsert({
    where: { email: "r2_vp@hermes.test" },
    update: { organizationId: org.id },
    create: { organizationId: org.id, name: "R2李总监", email: "r2_vp@hermes.test" },
  });

  const session = (u: typeof owner) => ({ userId: u.id, organizationId: u.organizationId, userEmail: u.email, userName: u.name });
  const priorEnv = process.env.NODE_ENV;
  const priorMock = process.env.DEV_MOCK_AUTH;
  try {
    Object.assign(process.env, { NODE_ENV: "production", DEV_MOCK_AUTH: "false" });
    const response = await login(new NextRequest("http://localhost/api/auth/session", {
      method: "POST", body: JSON.stringify({ email: leader.email }),
      headers: { "content-type": "application/json" },
    }));
    const body = await response.json();
    console.log(JSON.stringify({ probe: "unauthenticated_production_login", status: response.status, issuedToken: Boolean(body.token) }));
    if (response.status !== 401 && response.status !== 403) {
      throw new Error(`R2-01 Assertion Failure: Unauthenticated production login returned status ${response.status}, expected 401 or 403!`);
    }
    if (Boolean(body.token)) {
      throw new Error("R2-01 Assertion Failure: Token was issued for unauthenticated production login!");
    }
    if (body.sessionId) await testPrisma.session.update({ where: { id: body.sessionId }, data: { revokedAt: new Date() } });
  } finally {
    if (priorEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: priorEnv });
    if (priorMock === undefined) delete process.env.DEV_MOCK_AUTH; else process.env.DEV_MOCK_AUTH = priorMock;
  }
  // Add isolated test records only; never truncate or modify existing projects.
  const project = await createProject(session(owner), {
    title: "REVIEW_R2_DEMO", target: "Original test requirement", mode: "NEW_PRODUCT", isDemo: true, decisionMakerId: leader.id,
  });
  const evidence = await testPrisma.evidence.create({ data: {
    projectId: project.id, contentOrUri: "Synthetic review fixture", source: "REVIEW_TEST_ONLY", hash: "test-hash", nature: "DEMO", verifyStatus: "VERIFIED",
  } });
  const packet = await createDecisionPacketDraft(session(owner), {
    projectId: project.id, artifactVersions: [], evidenceVersions: [{ id: evidence.id, hash: evidence.hash }],
    budgetAmount: 100, budgetCurrency: "CNY", budgetScope: "Test scope", validationPlan: "Test plan",
  });
  await submitDecisionPacket(session(owner), packet.id);
  await updateProject(session(owner), project.id, { target: "Changed requirement after submission", expectedRevision: project.revision });
  let probe2Blocked = false;
  try {
    const result = await decideDecisionPacket(session(leader), packet.id, { decision: "APPROVE", reason: "Review probe" });
    console.log(JSON.stringify({ probe: "changed_requirements_and_missing_product_artifacts", approved: result.packet?.status === "APPROVED", nextTaskCreated: Boolean(result.nextWorkItem) }));
  } catch (error) {
    probe2Blocked = true;
    console.log(JSON.stringify({ probe: "changed_requirements_and_missing_product_artifacts", blocked: true, message: (error as Error).message }));
  }
  if (!probe2Blocked) {
    throw new Error("R2-02 Assertion Failure: Decision packet with changed requirement and missing deliverables was NOT blocked!");
  }

  const report = synthesizeMarketResearch(project.id, "TEST_CATEGORY", parseProjectRequirements("Research only from evidence").constraints, []);
  console.log(JSON.stringify({ probe: "empty_evidence_research", benchmarks: report.benchmarks.map(x => ({ sales: x.salesVolumeDesc, price: x.price, hasSource: Boolean(x.evidenceRefId) })) }));
  if (report.benchmarks.length > 0) {
    throw new Error(`R2-03 Assertion Failure: Market research with 0 verified evidence generated ${report.benchmarks.length} synthetic benchmarks!`);
  }
  console.log("\n✔ All B01-R2 probes passed as strict assertions! Zero regressions detected.");
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  await prisma.$disconnect(); await testPrisma.$disconnect();
});
