import { PrismaClient, ProjectMode, ProjectStage, Role, OrgRole, EvidenceNature, EvidenceVerifyStatus, ProducerType, WorkExecutorType, WorkItemStatus, GateType, DecisionPacketStatus } from "@prisma/client";
import { computeScopeHash } from "../src/modules/decisions/scope-hash";
import crypto from "crypto";
import { hashPassword } from "../src/modules/identity/session";

// 开发种子口令：优先取 SEED_PASSWORD 环境变量；未提供则随机生成并只在本次控制台输出（不写进代码/文档）
const seedPassword = process.env.SEED_PASSWORD ?? crypto.randomBytes(12).toString("base64url");

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding B01 development data...");

  // Clear existing
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "AuditEvent", "IdempotencyRecord", "Decision", "DecisionPacket", "Feedback", "Evidence", "Artifact", "RunReceipt", "WorkItem", "ProductVersion", "Product", "ProjectMember", "OrganizationMember", "Project", "User", "Organization" CASCADE;`);

  // 1. Organization
  const org = await prisma.organization.create({
    data: {
      name: "赫尔墨斯食品创新实验室（上海）",
      code: "HERMES_FOOD_DEV",
    },
  });

  const foreignOrg = await prisma.organization.create({
    data: {
      name: "外部合作与竞品机构",
      code: "FOREIGN_ORG",
    },
  });

  // 2. Users
  const pm = await prisma.user.create({
    data: {
      organizationId: org.id,
      passwordHash: hashPassword(seedPassword),
      email: "zhang_pm@hermes.test",
      name: "张负责 (研发PM)",
    },
  });

  const vp = await prisma.user.create({
    data: {
      organizationId: org.id,
      passwordHash: hashPassword(seedPassword),
      email: "li_vp@hermes.test",
      name: "李决策 (业务总监/VP)",
    },
  });

  const evaluator = await prisma.user.create({
    data: {
      organizationId: org.id,
      passwordHash: hashPassword(seedPassword),
      email: "wang_eval@hermes.test",
      name: "王评测 (感官评测员)",
    },
  });

  const foreignUser = await prisma.user.create({
    data: {
      organizationId: foreignOrg.id,
      passwordHash: hashPassword(seedPassword),
      email: "external@other.test",
      name: "外部观察员",
    },
  });

  // 2b. 组织成员关系（OrganizationMember）
  //     公司级能力只由本表决定：知识源配置 / 公司事实录入仅限 ORG_ADMIN。
  //     项目 OWNER **不再**隐式等于组织管理员（修 org-admin 权限自举）。
  await prisma.organizationMember.createMany({
    data: [
      { organizationId: org.id, userId: pm.id, role: OrgRole.ORG_ADMIN },
      { organizationId: org.id, userId: vp.id, role: OrgRole.MEMBER },
      { organizationId: org.id, userId: evaluator.id, role: OrgRole.MEMBER },
      { organizationId: foreignOrg.id, userId: foreignUser.id, role: OrgRole.ORG_ADMIN },
    ],
  });

  // 3. Sample 1: 新品研发项目 (NEW_PRODUCT)
  const pNew = await prisma.project.create({
    data: {
      organizationId: org.id,
      mode: ProjectMode.NEW_PRODUCT,
      title: "高多酚黑巧燕麦脆即食片研发 (REAL)",
      target: "以烘焙微胶囊技术保留多酚活性，研发高纤低糖代餐零食并完成打样验证",
      stage: ProjectStage.RESEARCH,
      ownerId: pm.id,
      decisionMakerId: vp.id,
    },
  });

  await prisma.projectMember.createMany({
    data: [
      { projectId: pNew.id, userId: pm.id, role: Role.OWNER },
      { projectId: pNew.id, userId: vp.id, role: Role.DECISION_MAKER },
      { projectId: pNew.id, userId: evaluator.id, role: Role.FEEDBACK_PROVIDER },
    ],
  });

  // Real Evidence
  const eviReal = await prisma.evidence.create({
    data: {
      projectId: pNew.id,
      contentOrUri: "2026年健康低卡代餐消费洞察：多酚抗氧化麦片品类月复合增长率125%",
      source: "蝉妈妈电商消费趋势研报 (已核实)",
      hash: "sha256-cmm-report-oats-2026",
      nature: EvidenceNature.REAL,
      verifyStatus: EvidenceVerifyStatus.VERIFIED,
    },
  });

  // Work Item
  const wItem = await prisma.workItem.create({
    data: {
      projectId: pNew.id,
      title: "烘焙微胶囊茶多酚留存率测试与实验报告",
      target: "完成80度烤制条件下多酚留存率测定，要求留存率>55%",
      deliverableReq: "实验原始数据表与稳定性分析报告",
      status: WorkItemStatus.ACCEPTED,
      executorType: WorkExecutorType.HUMAN,
    },
  });

  await prisma.artifact.create({
    data: {
      workItemId: wItem.id,
      // I-001 / I-002：成果归属组织与所绑产品版本（本项目未绑定版本 → null，不猜测）
      organizationId: org.id,
      productVersionId: pNew.productVersionId,
      // 自由文本实验报告：不声称 schema 版本，保持 NULL
      type: "LAB_REPORT",
      title: "微胶囊茶多酚高温留存率测定分析报告",
      content: "经三次平行测试，80度烘焙25分钟后多酚留存率为58.4%，水分活度0.28，感官无明显苦涩味。",
      producerType: ProducerType.MANUAL,
      inputRevision: 1,
      reviewStatus: "ACCEPTED",
    },
  });

  // Draft Decision Packet
  const scopeHash = computeScopeHash({
    projectId: pNew.id,
    gate: GateType.RESEARCH_SAMPLING_GATE,
    artifactVersions: [{ type: "LAB_REPORT", version: 1 }],
    evidenceVersions: [{ id: eviReal.id, hash: eviReal.hash }],
    budgetAmount: 60000.0,
    budgetScope: "仅限一期打样原料采购与初次实验室感官盲测评测",
    validationPlan: "组织30人双盲感官评测、水分活性及多酚留存率实验室检验",
  });

  await prisma.decisionPacket.create({
    data: {
      projectId: pNew.id,
      gate: GateType.RESEARCH_SAMPLING_GATE,
      artifactVersions: [{ type: "LAB_REPORT", version: 1 }],
      evidenceVersions: [{ id: eviReal.id, hash: eviReal.hash }],
      budgetAmount: 60000.0,
      budgetCurrency: "CNY",
      budgetScope: "仅限一期打样原料采购与初次实验室感官盲测评测",
      validationPlan: "组织30人双盲感官评测、水分活性及多酚留存率实验室检验",
      requiredChecks: { marketChecked: true, budgetScopeConfirmed: true },
      scopeHash,
      status: DecisionPacketStatus.IN_REVIEW,
      submittedAt: new Date(),
    },
  });

  // 4. Sample 2: 既有确认版本的固定产品复产样例 (FIXED_PRODUCT)
  const productFixed = await prisma.product.create({
    data: {
      organizationId: org.id,
      name: "经典无蔗糖海苔肉松饼",
      identityCode: "SKU-RSB-SEAWEED-01",
      targetAudience: "轻食、减糖与家庭休闲代餐人群",
      marketPath: "全国商超及电商精品专区",
      devMode: "经典成熟配方复产",
    },
  });

  const pvFixed = await prisma.productVersion.create({
    data: {
      productId: productFixed.id,
      versionTag: "v2.1-CONFIRMED",
      specs: { sugar: "0g/100g", seaweedContent: "15%", shelfLife: "90天" },
      isImmutable: true,
    },
  });

  const pFixed = await prisma.project.create({
    data: {
      organizationId: org.id,
      mode: ProjectMode.FIXED_PRODUCT,
      title: "经典无蔗糖海苔肉松饼复产准备 (FIXED)",
      target: "按既有 v2.1 确认标准进行原料锁定与产线包材中试",
      stage: ProjectStage.PRODUCTION_PREP,
      ownerId: pm.id,
      decisionMakerId: vp.id,
    },
  });

  await prisma.projectMember.createMany({
    data: [
      { projectId: pFixed.id, userId: pm.id, role: Role.OWNER },
      { projectId: pFixed.id, userId: vp.id, role: Role.DECISION_MAKER },
    ],
  });

  // 5. Sample 3: 无访问权限项目 (用于验证越权与安全隔离)
  const pUnauthorized = await prisma.project.create({
    data: {
      organizationId: foreignOrg.id,
      mode: ProjectMode.NEW_PRODUCT,
      title: "竞品机密功能调研项目 (RESTRICTED)",
      target: "仅外部企业内部受权人可见",
      stage: ProjectStage.DRAFT,
      ownerId: foreignUser.id,
    },
  });

  await prisma.projectMember.create({
    data: {
      projectId: pUnauthorized.id,
      userId: foreignUser.id,
      role: Role.OWNER,
    },
  });

  console.log("Seeding complete! Samples created:");
  console.log("1. 新品研发项目:", pNew.title, `(${pNew.id})`);
  console.log("2. 固定产品项目:", pFixed.title, `(${pFixed.id})`);
  console.log("3. 跨租户隔离项目:", pUnauthorized.title, `(${pUnauthorized.id})`);
  // 种子口令仅打印到本次控制台输出（开发库），不写入任何代码或文档
  console.log(`开发种子账号（zhang_pm / li_vp / wang_eval @hermes.test）本次口令: ${seedPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
