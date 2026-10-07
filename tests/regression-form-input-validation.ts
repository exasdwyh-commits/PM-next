import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ProjectMode, RunMode } from "@prisma/client";
import prisma from "../src/shared/db";
import { ConflictError, UnprocessableEntityError } from "../src/shared/errors";
import { assertTestDatabaseSafety } from "./test-safety";
import { createProduct, createDevelopmentProduct, publishProductVersion } from "../src/modules/products/service";
import { createProject, updateProject } from "../src/modules/projects/service";
import { createWorkItem, submitWork, reviewWork } from "../src/modules/work/service";
import { createKernConversation } from "../src/modules/assistant-runtime/conversations";
import { updateKernConversationRuntimeConfig } from "../src/modules/assistant-runtime/conversation-config";

async function main() {
  await assertTestDatabaseSafety(prisma);
  const tag = randomUUID();
  const org = await prisma.organization.create({ data: { name: "Form validation", code: `FORM_${tag}` } });
  const owner = await prisma.user.create({ data: { organizationId: org.id, email: `form-${tag}@hermes.test`, name: "Form owner" } });
  const session = { organizationId: org.id, userId: owner.id, userEmail: owner.email, userName: owner.name };
  const failures: string[] = [];
  let checks = 0;
  async function rejectsInput(label: string, action: () => Promise<unknown>) {
    checks++;
    try {
      await assert.rejects(action, UnprocessableEntityError);
      console.log(`PASS ${label}`);
    } catch (error) {
      failures.push(label);
      console.log(`FAIL ${label}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    }
  }
  try {
    const productInput = { name: "产品", identityCode: `QA_${tag}`, targetAudience: "人群", marketPath: "渠道", devMode: "NEW_PRODUCT" };
    await rejectsInput("product null body", () => createProduct(session, null as never));
    await rejectsInput("product numeric name", () => createProduct(session, { ...productInput, name: 12 as never }));
    await rejectsInput("product array body", () => createProduct(session, [] as never));
    const developmentInput = { name: "入库产品", coreIdea: "想法", targetAudience: "人群", coreSellingPoints: "卖点", targetChannels: "渠道" };
    await rejectsInput("ingest numeric selling points", () => createDevelopmentProduct(session, { ...developmentInput, coreSellingPoints: 12 as never }));
    await rejectsInput("ingest numeric optional price", () => createDevelopmentProduct(session, { ...developmentInput, priceExpectation: 12 as never }));
    await rejectsInput("ingest invalid target cost", () => createDevelopmentProduct(session, { ...developmentInput, targetCost: "cheap" as never }));
    await rejectsInput("ingest negative target cost", () => createDevelopmentProduct(session, { ...developmentInput, targetCost: -1 }));
    await rejectsInput("ingest invalid date type", () => createDevelopmentProduct(session, { ...developmentInput, targetLaunchDate: {} as never }));
    const development = await createDevelopmentProduct(session, { ...developmentInput, name: " 入库产品 ", targetCost: 0 });
    assert.equal(development.product.name, "入库产品");
    assert.equal(Number(development.version.targetCost), 0);
    const versionInput = { versionTag: "v2", specs: { note: "QA" } };
    await rejectsInput("version numeric tag", () => publishProductVersion(session, development.product.id, { ...versionInput, versionTag: 12 as never }));
    await rejectsInput("version numeric specs", () => publishProductVersion(session, development.product.id, { ...versionInput, specs: 12 as never }));
    await rejectsInput("version string confirmed flag", () => publishProductVersion(session, development.product.id, { ...versionInput, isConfirmed: "false" as never }));
    await rejectsInput("version invalid currency", () => publishProductVersion(session, development.product.id, { ...versionInput, currency: {} as never }));
    await rejectsInput("version negative cost", () => publishProductVersion(session, development.product.id, { ...versionInput, targetCost: -1 }));
    assert.equal(await prisma.productVersion.count({ where: { productId: development.product.id } }), 1);
    checks += 3;
    const projectInput = { title: "验证项目", target: "验证目标", mode: ProjectMode.NEW_PRODUCT };
    await rejectsInput("project numeric title", () => createProject(session, { ...projectInput, title: 12 as never }));
    await rejectsInput("project whitespace title", () => createProject(session, { ...projectInput, title: "   " }));
    await rejectsInput("project invalid mode", () => createProject(session, { ...projectInput, mode: "OTHER" as never }));
    await rejectsInput("project string demo flag", () => createProject(session, { ...projectInput, isDemo: "false" as never }));
    await rejectsInput("project invalid decision maker type", () => createProject(session, { ...projectInput, decisionMakerId: [] as never }));
    const project = await createProject(session, projectInput);
    await rejectsInput("project missing revision", () => updateProject(session, project.id, { target: "不得覆盖" } as never));
    await rejectsInput("project numeric target", () => updateProject(session, project.id, { target: 12 as never, expectedRevision: project.revision }));
    await rejectsInput("project whitespace target", () => updateProject(session, project.id, { target: "   ", expectedRevision: project.revision }));
    await rejectsInput("project invalid constraints", () => updateProject(session, project.id, { constraints: [] as never, expectedRevision: project.revision }));
    for (const revision of [0, 1.5, "1", null]) {
      await rejectsInput(`project invalid revision ${JSON.stringify(revision)}`, () => updateProject(session, project.id, { target: "不得覆盖", expectedRevision: revision as never }));
    }
    const persisted = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    checks++;
    if (persisted.revision !== project.revision || persisted.target !== project.target) failures.push("invalid project update mutated data");

    const workInput = { title: "验证任务", target: "验证目标", deliverableReq: "验证成果" };
    await rejectsInput("work item numeric title", () => createWorkItem(session, project.id, { ...workInput, title: 12 as never }));
    await rejectsInput("work item whitespace title", () => createWorkItem(session, project.id, { ...workInput, title: "   " }));
    await rejectsInput("work item invalid executor", () => createWorkItem(session, project.id, { ...workInput, executorType: "OTHER" as never }));
    await rejectsInput("work item invalid dependencies", () => createWorkItem(session, project.id, { ...workInput, dependencies: "oops" as never }));
    const work = await createWorkItem(session, project.id, workInput);
    await rejectsInput("submission invalid artifacts array", () => submitWork(session, work.id, { inputRevision: persisted.revision, runMode: RunMode.MANUAL, artifacts: "oops" as never }));
    await rejectsInput("submission invalid artifact fields", () => submitWork(session, work.id, { inputRevision: persisted.revision, runMode: RunMode.MANUAL, artifacts: [{ type: "REPORT", title: 12 as never, content: "结果" }] }));
    await rejectsInput("submission invalid receipt status", () => submitWork(session, work.id, { inputRevision: persisted.revision, runMode: RunMode.MANUAL, status: "OTHER" as never }));
    await rejectsInput("submission invalid error message", () => submitWork(session, work.id, { inputRevision: persisted.revision, runMode: RunMode.MANUAL, errorMessage: {} as never }));
    const submitted = await submitWork(session, work.id, { inputRevision: persisted.revision, runMode: RunMode.MANUAL, artifacts: [{ type: "REPORT", title: "结果", content: "验证成果" }] });
    await rejectsInput("review string false", () => reviewWork(session, work.id, { accepted: "false" as never, reason: "应被拒绝的非法参数" }));
    await rejectsInput("review missing accepted", () => reviewWork(session, work.id, { reason: "应被拒绝的非法参数" } as never));
    await rejectsInput("review numeric reason", () => reviewWork(session, work.id, { accepted: false, reason: 12 as never }));
    const afterReview = await prisma.workSubmission.findUniqueOrThrow({ where: { id: submitted.submission!.id } });
    checks++;
    if (afterReview.status !== "PENDING") failures.push("invalid review accepted submission");

    const conversation = await createKernConversation(session, { title: "配置验证" });
    await updateKernConversationRuntimeConfig(session, conversation.id, { capabilityKeys: ["knowledge"] });
    for (const invalid of [undefined, null, [], { advisorCodes: "bad" }, { skillKeys: [12] }, { capabilityKeys: ["unknown"] }, { modelProfileKey: 12 }, { version: "future" }]) {
      await rejectsInput(`runtime malformed config ${JSON.stringify(invalid)}`, () => updateKernConversationRuntimeConfig(session, conversation.id, invalid));
    }
    const saved = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    checks++;
    assert.deepEqual(saved.runtimeConfig, { version: "kern-conversation-config/v1", modelProfileKey: null, advisorCodes: null, skillKeys: null, capabilityKeys: ["knowledge"] });

    // Positive paths keep the existing text trimming, revision conflict, and AUTO semantics.
    const updated = await updateProject(session, project.id, { target: " 新目标 ", expectedRevision: project.revision });
    assert.equal(updated?.target, "新目标");
    assert.equal(updated?.revision, project.revision + 1);
    await assert.rejects(() => updateProject(session, project.id, { target: "过期目标", expectedRevision: project.revision }), ConflictError);
    const reviewed = await reviewWork(session, work.id, { accepted: false, reason: " 需要修改 " });
    assert.equal(reviewed.status, "CHANGES_REQUESTED");
    const storedReview = await prisma.workSubmission.findUniqueOrThrow({ where: { id: submitted.submission!.id } });
    assert.equal(storedReview.reviewReason, "需要修改");
    const explicitNone = await updateKernConversationRuntimeConfig(session, conversation.id, { capabilityKeys: [] });
    assert.deepEqual(explicitNone.capabilityKeys, []);
    const automatic = await updateKernConversationRuntimeConfig(session, conversation.id, {});
    assert.equal(automatic.capabilityKeys, null);
    checks += 7;
    assert.deepEqual(failures, [], `${checks} input checks; failures: ${failures.join(", ")}`);
    console.log(`PASS all ${checks} form input regression checks`);
  } finally {
    await prisma.project.deleteMany({ where: { organizationId: org.id } });
    await prisma.auditEvent.deleteMany({ where: { actorId: owner.id } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
