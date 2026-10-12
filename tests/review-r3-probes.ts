import prisma from "../src/shared/db";
import { assertTestDatabaseSafety } from "./test-safety";
import { createProject } from "../src/modules/projects/service";
import { createDecisionPacketDraft, submitDecisionPacket, decideDecisionPacket } from "../src/modules/decisions/service";
import { parseProjectRequirements } from "../src/modules/research/requirement-parser";
import { synthesizeMarketResearch } from "../src/modules/research/market-research";
import { assembleProductSuggestionPackage, commitProductSuggestionToGate } from "../src/modules/products/product-suggestion";

async function main() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("Explicit test database required");
  await assertTestDatabaseSafety(prisma);

  // Self-contained test users and organization to avoid run-order dependencies
  const org = await prisma.organization.upsert({
    where: { code: "R3_PROBE_ORG" },
    update: {},
    create: { name: "R3 验收诊断机构", code: "R3_PROBE_ORG" },
  });

  const owner = await prisma.user.upsert({
    where: { email: "r3_pm@hermes.test" },
    update: { organizationId: org.id },
    create: { organizationId: org.id, name: "R3张主管", email: "r3_pm@hermes.test" },
  });

  const leader = await prisma.user.upsert({
    where: { email: "r3_vp@hermes.test" },
    update: { organizationId: org.id },
    create: { organizationId: org.id, name: "R3李总监", email: "r3_vp@hermes.test" },
  });

  const session = (u: typeof owner) => ({ userId: u.id, organizationId: u.organizationId, userEmail: u.email, userName: u.name });

  const makeProject = async (suffix: string) => {
    const p = await createProject(session(owner), {
      title: `REVIEW_R3_${suffix}_${Date.now()}`,
      target: "Synthetic test only",
      mode: "NEW_PRODUCT",
      isDemo: true,
      decisionMakerId: leader.id,
    });
    const e = await prisma.evidence.create({
      data: {
        projectId: p.id,
        contentOrUri: "Synthetic material with verified price",
        source: "REVIEW_TEST_ONLY",
        hash: `review-test-${Date.now()}`,
        nature: "DEMO",
        verifyStatus: "VERIFIED",
        claims: {
          create: [
            {
              fieldKey: "price",
              fieldName: "竞品价格",
              kind: "FACT",
              value: "49.9",
              currency: "CNY",
            },
          ],
        },
      },
    });
    return { p, e };
  };

  console.log("=== Running R3 Probes as Strict Regression Assertions ===");

  // --- Probe C01: Approval must validate real business objects (ProductVersion and real accepted Artifacts) ---
  console.log("\n▶ Asserting C01: Phony/nonexistent artifacts or missing product versions must be blocked from approval...");
  const { p, e } = await makeProject("claimed_artifact");
  const packet = await createDecisionPacketDraft(session(owner), {
    projectId: p.id,
    artifactVersions: [{ type: "NONEXISTENT_REPORT", version: 1 }],
    evidenceVersions: [{ id: e.id, hash: e.hash }],
    budgetAmount: 100,
    budgetCurrency: "CNY",
    budgetScope: "Test",
    validationPlan: "Test",
  });
  await submitDecisionPacket(session(owner), packet.id);

  let c01Blocked = false;
  try {
    const decision = await decideDecisionPacket(session(leader), packet.id, { decision: "APPROVE", reason: "Diagnostic only" });
    if (decision.packet?.status === "APPROVED") {
      console.error("❌ C01 Failure: Phony report with 0 real artifacts and no product version was APPROVED!");
    }
  } catch (err: any) {
    if (err.statusCode === 422 || err.statusCode === 409) {
      c01Blocked = true;
    } else {
      throw err;
    }
  }
  if (!c01Blocked) {
    throw new Error("C01 Assertion Failure: Approval of decision packet with nonexistent deliverables was not blocked!");
  }
  console.log("✔ C01 Guard confirmed: Approval blocked when deliverables do not physically exist in DB with ACCEPTED status.");

  // --- Probe C02: Missing price in evidence must remain null instead of fabricated basePrice fallback ---
  console.log("\n▶ Asserting C02: Unknown prices must remain null/empty without synthetic extrapolation...");
  const constraints = parseProjectRequirements("Research from supplied materials only").constraints;
  const reportNoPrice = synthesizeMarketResearch("test", "TEST", constraints, [
    { id: "test-no-price", content: "This source contains no price or sales information", source: "REVIEW_TEST_ONLY" },
  ]);
  const extractedPrices = reportNoPrice.benchmarks.map((b) => b.price);
  if (extractedPrices.some((p) => p !== null)) {
    throw new Error(`C02 Assertion Failure: Evidence without price resulted in fabricated price: ${JSON.stringify(extractedPrices)}`);
  }
  console.log("✔ C02 Guard confirmed: Evidence without price resulted in null price.");

  // --- Probe C03: Idempotency: Re-submitting identical suggestion must reuse versions and packet ---
  console.log("\n▶ Asserting C03: Idempotent commitment must reuse product version and decision packet...");
  const { p: draftProject } = await makeProject("assumptions");
  const suggestion = await assembleProductSuggestionPackage(session(owner), draftProject.id);
  const idempKey = `idemp-sug-${draftProject.id}-${Date.now()}`;
  const first = await commitProductSuggestionToGate(session(owner), draftProject.id, suggestion, { idempotencyKey: idempKey });
  const second = await commitProductSuggestionToGate(session(owner), draftProject.id, suggestion, { idempotencyKey: idempKey });

  if (first.productVersion.id !== second.productVersion.id || first.decisionPacket.id !== second.decisionPacket.id) {
    throw new Error(
      `C03 Assertion Failure: Repeated identical suggestion commitments created different records (v1=${first.productVersion.id}, v2=${second.productVersion.id})`
    );
  }
  console.log("✔ C03 Guard confirmed: Re-submitting identical suggestion reuses existing version and decision packet.");

  // --- Probe C04: Unconfirmed assumptions must remain isConfirmed=false and cannot be approved until confirmed ---
  console.log("\n▶ Asserting C04: Unconfirmed assumptions cannot be automatically confirmed or approved...");
  if (second.productVersion.isConfirmed) {
    throw new Error("C04 Assertion Failure: Product version with unconfirmed assumptions was marked isConfirmed=true!");
  }

  await submitDecisionPacket(session(owner), second.decisionPacket.id);
  let c04ApprovalBlocked = false;
  try {
    await decideDecisionPacket(session(leader), second.decisionPacket.id, { decision: "APPROVE", reason: "Diagnostic only" });
  } catch (err: any) {
    if (err.statusCode === 422) {
      c04ApprovalBlocked = true;
    }
  }
  if (!c04ApprovalBlocked) {
    throw new Error("C04 Assertion Failure: Decision packet with unconfirmed economic assumptions was APPROVED!");
  }
  console.log("✔ C04 Guard confirmed: Gate approval blocked when assumptions remain unconfirmed.");

  // --- Positive Business Case: When assumptions are explicitly confirmed and deliverables are present, gate approval succeeds ---
  console.log("\n▶ Asserting Positive Business Case: Compliant suggestion with confirmed assumptions and deliverables is APPROVED...");
  const { p: validProj, e: validEvi } = await makeProject("valid_full_chain");
  // Also add a price in evidence
  const validPriceEvi = await prisma.evidence.create({
    data: {
      projectId: validProj.id,
      contentOrUri: "同类优质高多酚茶粉零售价 89.9 元，月销 2万件",
      source: "蝉妈妈真实采样",
      hash: "valid-price-hash",
      nature: "DEMO",
      verifyStatus: "VERIFIED",
    },
  });

  // Test C02 positive case: Evidence with price extracts exact price
  const reportWithPrice = synthesizeMarketResearch("test", "TEST", constraints, [
    { id: validPriceEvi.id, content: validPriceEvi.contentOrUri, source: validPriceEvi.source },
  ]);
  if (reportWithPrice.benchmarks[0].price !== 89.9) {
    throw new Error(`C02 Assertion Failure: Evidence with price 89.9 was not parsed correctly: ${reportWithPrice.benchmarks[0].price}`);
  }
  console.log("✔ C02 Positive case confirmed: Real price (89.9) extracted precisely from evidence.");

  const validSuggestion = await assembleProductSuggestionPackage(session(owner), validProj.id, {
    businessOptions: {
      commissionRate: 20.0,
      marketingRate: 7.0,
      batchQuantity: 2000,
      shelfLifeMonths: 18,
      netWeight: "4g × 20包",
    },
  });

  const validCommitment = await commitProductSuggestionToGate(session(owner), validProj.id, validSuggestion, {
    isConfirmed: true, // Explicit formal confirmation
    budgetScope: "一期全套试制原料与第三方检测",
    validationPlan: "第三方多酚活性检测",
  });

  if (!validCommitment.productVersion.isConfirmed) {
    throw new Error("Positive case failure: ProductVersion was not confirmed after explicit confirmation!");
  }

  // Submit and approve
  await submitDecisionPacket(session(owner), validCommitment.decisionPacket.id);
  const validApproval = await decideDecisionPacket(session(leader), validCommitment.decisionPacket.id, {
    decision: "APPROVE",
    reason: "所有规格成果已在库验收，商业假设已正式确认，市场证据充分，准予打样",
  });

  if (validApproval.packet?.status !== "APPROVED" || validApproval.project.stage !== "SAMPLING") {
    throw new Error("Positive case failure: Valid decision packet failed to approve and advance to SAMPLING!");
  }
  console.log("✔ Positive full business flow confirmed: Approved and successfully advanced project stage to SAMPLING.");

  console.log("\n🏆 All R3 regression assertions & positive business cases PASSED!");
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
