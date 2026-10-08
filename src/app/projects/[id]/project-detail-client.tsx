"use client";
import { getTenantPack } from "@/modules/tenant";
const TENANT_UI = getTenantPack().tenant.ui;

import React, { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import AppShell from "@/components/app-shell";
import { Panel, PageHeading, Badge, Empty, Modal } from "@/components/ui";
import { StepTrack, GateLine, type StepItem, type GateNode } from "@/components/viz";
import Icon from "@/components/icons";
import { Notice } from "@/components/notice";
import { useTabInk, useTabSwap } from "@/components/motion/tabs";
import { useReasonDialog } from "@/components/reason-dialog";
import { identityHeaders } from "@/shared/client-identity";
import { OverviewRoleBased } from "./components/overview-role-based";
import { CostCalculatorModular } from "@/components/cost-calculator-modular";
import "@/components/cost-calculator-modular.css";
import "@/components/role-tools.css";
import { RoleProvider } from "@/components/role-context";
import "@/components/role-switch.css";
import { fmtDateTime, fmtTime } from "@/shared/datetime";
import type { RuntimeStatus } from "@/shared/runtime-status";
import { PROJECT_WORKSPACE_TABS, prepareArtifactSubmission, preparePacketBudget, projectStagesForMode } from "./project-workspace";
import {
  labelRunMode,
  labelProjectMode,
  labelProjectStage,
  labelOpportunityType,
  labelOpportunityElement,
  labelValidationStatus,
  labelDecisionPacketStatus,
  labelWorkItemStatus,
  labelWorkExecutorType,
  labelArtifactType,
  labelAgentRunStatus,
  labelEvidenceNature,
  labelEvidenceVerifyStatus,
  labelEvidenceClaimKind,
  labelFeedbackStatus,
} from "@/shared/status-labels";

const STRUCTURED_SUBMISSION_TYPES = new Set([
  "COST_SCENARIO",
  "PROFESSIONAL_ANALYSIS",
  "PROFESSIONAL_CONFIRMATION",
  "SUPPLIER_QUOTE",
  "SAMPLE_ROUND",
  "PACKAGING_BRIEF",
  "PRODUCTION_PLAN",
  "PRODUCTION_RECORD",
  "BUSINESS_OBSERVATION",
]);

const ProductRndPanel = dynamic(
  () => import("@/components/product-rnd-panel").then((module) => module.ProductRndPanel),
  { loading: () => <div className="hermes-note" role="status">正在加载研发工作区…</div> }
);

function ArtifactContent({ id, content }: { id: string; content: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = content.length > 600;
  return (
    <div>
      <div id={`artifact-content-${id}`} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {long && !expanded ? `${content.slice(0, 240)}…` : content}
      </div>
      {long && <button type="button" className="hermes-link" aria-expanded={expanded} aria-controls={`artifact-content-${id}`} onClick={() => setExpanded((value) => !value)}>{expanded ? "收起成果内容" : "展开完整成果"}</button>}
    </div>
  );
}

export default function ProjectDetailClient({
  initialProject,
  allUsers,
  currentSession,
  gaps,
  initialEvidenceInsight,
  initialOpportunity,
  runtime,
  mockAuth = false,
}: {
  initialProject: any;
  allUsers: any[];
  currentSession?: any;
  gaps: string[];
  mockAuth?: boolean;
  initialEvidenceInsight?: {
    resolved: any[];
    conflicts: any[][];
    gaps: { fieldKey: string; fieldName: string; description: string }[];
  } | null;
  initialOpportunity?: any;
  runtime: RuntimeStatus;
}) {
  const [project, setProject] = useState(initialProject);
  const [currentGaps, setCurrentGaps] = useState(gaps);
  const [activeUserId, setActiveUserId] = useState(currentSession?.userId || initialProject.ownerId);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<"overview" | "overview-old" | "rnd" | "cost" | "tasks" | "evidence" | "decisions" | "records">("overview");
  const [saving, setSaving] = useState(false);
  const savingRef = React.useRef(false);
  const messageTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshVersion = React.useRef(0);
  // KX-28：工作区标签的选中底板滑动；切换内容时高度平滑、内容淡入、视野回到标签栏下方。
  const workspaceTabsRef = React.useRef<HTMLDivElement>(null);
  const workspacePanelRef = React.useRef<HTMLDivElement>(null);
  useTabInk(workspaceTabsRef, activeWorkspaceTab);
  useTabSwap(workspacePanelRef, activeWorkspaceTab, workspaceTabsRef);
  // 理由输入对话框（替代原生 prompt）
  const [askReason, reasonDialog] = useReasonDialog();

  // Modals state
  const [showWorkModal, setShowWorkModal] = useState(false);
  const [workTitle, setWorkTitle] = useState("");
  const [workTarget, setWorkTarget] = useState("");
  const [workDeliverable, setWorkDeliverable] = useState("");
  // F03: 新任务可选前置依赖；F05: 执行方式
  const [workDependencies, setWorkDependencies] = useState<string[]>([]);
  const [workExecutorType, setWorkExecutorType] = useState("HUMAN");

  const [showSubmissionModal, setShowSubmissionModal] = useState<string | null>(null);
  const [subArtifactTitle, setSubArtifactTitle] = useState("");
  const [subArtifactType, setSubArtifactType] = useState("RESEARCH_REPORT");
  const [subArtifactContent, setSubArtifactContent] = useState("");
  const [subRunMode, setSubRunMode] = useState("MANUAL");
  const [productionContext, setProductionContext] = useState<any>(null);

  const [showEvidenceModal, setShowEvidenceModal] = useState(false);
  const [evidenceContent, setEvidenceContent] = useState("");
  const [evidenceSource, setEvidenceSource] = useState("");
  const [evidenceNature, setEvidenceNature] = useState("REAL");
  const [evidenceObtainedAt, setEvidenceObtainedAt] = useState("");

  // P1-01: 统一证据结构的覆盖/缺口/冲突洞察。初始值由服务端（page.tsx）计算避免挂载即 403，
  // 用户操作（核实/新增）后仅 mock 会话下刷新。
  const [evidenceInsight, setEvidenceInsight] = useState(initialEvidenceInsight ?? null);
  // P1-02: 机会分析与市场验证
  const [opportunity, setOpportunity] = useState<any>(initialOpportunity ?? null);
  // P1-02: OWNER 验证录入表单
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [validationEvidenceId, setValidationEvidenceId] = useState("");
  const [validationSampleSize, setValidationSampleSize] = useState("");
  const [validationTimeRange, setValidationTimeRange] = useState("");
  const [validationLimitations, setValidationLimitations] = useState("");
  const [validationStatus, setValidationStatus] = useState("IN_PROGRESS");

  const [feedbackContent, setFeedbackContent] = useState("");

  const [showPacketModal, setShowPacketModal] = useState(false);
  const [packetBudget, setPacketBudget] = useState("");
  const [packetScope, setPacketScope] = useState("");
  const [packetPlan, setPacketPlan] = useState("");

  const isOwner = activeUserId === project.ownerId;
  const isDecisionMaker = activeUserId === project.decisionMakerId;
  const workItemById = React.useMemo(() => new Map<string, any>((project.workItems ?? []).map((item: any) => [item.id, item])), [project.workItems]);
  const productRndWorkItem = (project.workItems ?? []).find(
    (item: any) =>
      item.title === "产品研发综合评估" &&
      item.executorType === "DIGITAL_WORKER"
  );

  const showMsg = (text: string, type: "success" | "error" = "success") => {
    if (messageTimer.current) clearTimeout(messageTimer.current);
    setMessage({ text, type });
    if (type === "success") messageTimer.current = setTimeout(() => setMessage(null), 5000);
  };

  React.useEffect(() => () => {
    if (messageTimer.current) clearTimeout(messageTimer.current);
    refreshVersion.current += 1;
  }, []);

  React.useEffect(() => {
    refreshVersion.current += 1;
    setProject(initialProject);
    setCurrentGaps(gaps);
    setEvidenceInsight(initialEvidenceInsight ?? null);
    setOpportunity(initialOpportunity ?? null);
  }, [initialProject, gaps, initialEvidenceInsight, initialOpportunity]);

  const runMutation = async (action: () => Promise<void>) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      showMsg(error instanceof Error ? error.message : "操作失败，请稍后重试", "error");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const formError = message?.type === "error" ? (
    <div className="hermes-banner is-danger" role="alert">{message.text}</div>
  ) : null;

  const reloadProject = async () => {
    const version = ++refreshVersion.current;
    try {
      const headers = identityHeaders(mockAuth, activeUserId);
      const [res, productionRes] = await Promise.all([
        fetch(`/api/projects/${project.id}`, { headers }),
        fetch(`/api/projects/${project.id}/production`, { headers }),
      ]);
      if (!res.ok) throw new Error("操作已保存，但项目最新数据加载失败，请刷新重试");
      const [data, productionData] = await Promise.all([
        res.json(), productionRes.ok ? productionRes.json() : Promise.resolve(null),
      ]);
      if (version !== refreshVersion.current) return;
      setProject(data);
      if (Array.isArray(data.gaps)) setCurrentGaps(data.gaps);
      setProductionContext(productionData);
    } catch (error) {
      if (version === refreshVersion.current) {
        showMsg(error instanceof Error ? error.message : "项目最新数据加载失败，请刷新重试", "error");
      }
    }
  };

  React.useEffect(() => {
    let cancelled = false;
    const version = refreshVersion.current;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}/production`, {
          headers: identityHeaders(mockAuth, activeUserId),
        });
        const data = res.ok ? await res.json() : null;
        if (!cancelled && version === refreshVersion.current) setProductionContext(data);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id, activeUserId, mockAuth]);

  // P1-01: 用户操作后刷新证据洞察（仅首次无障；挂载时用服务端初始值，避免 x-user-id 头在非 mock 会话下触发 403）
  const fetchEvidenceInsight = async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/evidence-gaps`, {
        headers: identityHeaders(mockAuth, activeUserId),
      });
      if (res.ok) setEvidenceInsight(await res.json());
    } catch (e) {
      console.error(e);
    }
  };

  // P1-02: 机会分析与市场验证（基于已核实证据，由服务端合成，前端仅展示与录入）
  const fetchOpportunity = async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/opportunity`, {
        headers: identityHeaders(mockAuth, activeUserId),
      });
      if (res.ok) setOpportunity(await res.json());
    } catch (e) {
      console.error(e);
    }
  };

  // API Call helper
  const apiCall = async (url: string, method: string, body?: any) => {
    try {
      const res = await fetch(url, {
        method,
        headers: identityHeaders(mockAuth, activeUserId, { "Content-Type": "application/json" }),
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.message || "请求失败，请稍后重试");
      }
      return data;
    } catch (err) {
      if (err instanceof TypeError) throw new Error("网络连接失败，请检查连接后重试");
      throw err;
    }
  };

  // 1. Create Work Item
  const handleCreateWorkItem = async (e: React.FormEvent) => {
    e.preventDefault();
    await runMutation(async () => {
      if (!workTitle.trim() || !workTarget.trim() || !workDeliverable.trim()) {
        throw new Error("请填写工作项名称、执行目标和交付物要求");
      }
      await apiCall(`/api/projects/${project.id}/work-items`, "POST", {
        title: workTitle.trim(),
        target: workTarget.trim(),
        deliverableReq: workDeliverable.trim(),
        executorType: workExecutorType,
        dependencies: workDependencies,
      });
      showMsg("工作项创建成功");
      setShowWorkModal(false);
      setWorkTitle("");
      setWorkTarget("");
      setWorkDeliverable("");
      setWorkDependencies([]);
      setWorkExecutorType("HUMAN");
      await reloadProject();
    });
  };

  const latestAcceptedArtifactId = (type: string): string | null => {
    const rows = project.workItems
      .flatMap((w: any) => w.artifacts ?? [])
      .filter((a: any) => a.type === type && a.reviewStatus === "ACCEPTED");
    return rows[0]?.id ?? null;
  };

  const structuredTemplate = (type: string): string => {
    const base = { dataNature: "DEMO", assumptions: [], missingInputs: [] };
    const plus90 = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const latestG2 = (project.decisionPackets ?? []).find(
      (p: any) => p.gate === "PRODUCTION_GATE" && p.status === "APPROVED"
    );
    const templates: Record<string, any> = {
      COST_SCENARIO: {
        ...base,
        engineVersion: "1.0",
        scenarioName: "基础生产成本情景",
        currency: "CNY",
        unit: "盒",
        expenseBase: "出厂口径",
        result: 10,
      },
      SUPPLIER_QUOTE: {
        ...base,
        supplierRef: "供应商/工厂名称",
        specification: "当前产品规格",
        quantity: 1000,
        moq: 1000,
        unitPrice: 10,
        currency: "CNY",
        taxBasis: "含税",
        leadTime: "30天",
        validUntil: plus90,
        paymentTerms: "示例：30%预付款，70%发货前付清",
      },
      SAMPLE_ROUND: {
        ...base,
        round: 1,
        factoryRef: "打样工厂",
        sampleDate: new Date().toISOString().slice(0, 10),
        verdict: "PASS",
        issues: [],
        nextAction: "进入生产准备",
      },
      PROFESSIONAL_CONFIRMATION: {
        ...base,
        domain: "生产/合规",
        appliesToIdentity: "当前产品身份",
        appliesToRegion: "中国大陆",
        appliesToChannel: "计划销售渠道",
        materialRefs: [],
        scopeItems: ["产品身份", "标签/宣称", "生产条件"],
        validUntil: plus90,
        confirmedByPerson: "实际确认人",
        recordedByPerson: "录入人",
      },
      PACKAGING_BRIEF: {
        ...base,
        packagingVersion: "P1",
        format: "盒/袋/瓶等",
        material: "包装材质",
        specification: "包装规格尺寸",
        complianceNotes: ["标签信息已核对"],
      },
      PRODUCTION_PLAN: {
        ...base,
        quantity: 1000,
        unit: "盒",
        budget: 10000,
        currency: "CNY",
        quoteRefs: [latestAcceptedArtifactId("SUPPLIER_QUOTE") ?? "粘贴 SUPPLIER_QUOTE 成果ID"],
        sampleRefs: project.mode === "NEW_PRODUCT"
          ? [latestAcceptedArtifactId("SAMPLE_ROUND") ?? "粘贴 SAMPLE_ROUND 成果ID"]
          : [],
        packagingRefs: [latestAcceptedArtifactId("PACKAGING_BRIEF") ?? "粘贴 PACKAGING_BRIEF 成果ID"],
        leadTime: "30天",
        productionConditions: ["报价仍有效", "包装与专业确认未变化"],
        stopConditions: ["数量/金额/规格越界", "报价或专业确认失效"],
      },
      PRODUCTION_RECORD: {
        ...base,
        authorizationRef: latestG2?.id ?? "粘贴已批准 G2 决策包ID",
        batchNo: "BATCH-001",
        quantity: 1000,
        unit: "盒",
        factoryRef: "实际生产工厂",
        producedAt: new Date().toISOString().slice(0, 10),
        conditions: ["按已批准生产计划执行"],
        exceptions: [],
        deliveryConfirmation: "填写真实出货/入仓/签收凭据摘要",
      },
    };
    return templates[type] ? JSON.stringify(templates[type], null, 2) : "";
  };

  // 2. Submit Deliverables
  const handleSubmitDeliverables = async (workItemId: string) => {
    await runMutation(async () => {
      const structured = STRUCTURED_SUBMISSION_TYPES.has(subArtifactType);
      const artifact = prepareArtifactSubmission(subArtifactTitle, subArtifactContent, structured);
      await apiCall(`/api/work-items/${workItemId}/submissions`, "POST", {
        inputRevision: project.revision,
        runMode: subRunMode,
        artifacts: [
          {
            type: subArtifactType,
            ...artifact,
            ...(structured ? { schemaVersion: "1.0" } : {}),
          },
        ],
      });
      showMsg("成果交付物已提交，需负责人验收后才能进入正式门禁");
      setShowSubmissionModal(null);
      setSubArtifactTitle("");
      setSubArtifactType("RESEARCH_REPORT");
      setSubArtifactContent("");
      await reloadProject();
    });
  };

  // 3. Review Work Item
  const handleReviewWorkItem = async (workItemId: string, accepted: boolean) => {
    if (savingRef.current) return;
    const reason = await askReason(
      accepted
        ? { title: "验收成果", label: "请输入验收通过意见", placeholder: "填写验收意见…", confirmText: "通过", tone: "primary" }
        : { title: "退回成果", label: "请输入退回修改理由", placeholder: "填写退回理由…", confirmText: "退回修改", tone: "danger" }
    );
    if (!reason) return;
    await runMutation(async () => {
      await apiCall(`/api/work-items/${workItemId}/reviews`, "POST", {
        accepted,
        reason,
      });
      showMsg(accepted ? "成果已验收通过" : "成果已退回并要求修改");
      await reloadProject();
    });
  };

  // 4. Add Evidence
  const handleAddEvidence = async (e: React.FormEvent) => {
    e.preventDefault();
    await runMutation(async () => {
      if (!evidenceContent.trim() || !evidenceSource.trim()) {
        throw new Error("请填写证据内容和数据来源");
      }
      await apiCall(`/api/projects/${project.id}/evidences`, "POST", {
        contentOrUri: evidenceContent.trim(),
        source: evidenceSource.trim(),
        nature: evidenceNature,
        obtainedAt: evidenceObtainedAt || undefined,
      });
      // A3: 新证据一律 UNVERIFIED，需负责人独立核实；不再谎称“已核实”
      showMsg("证据已存入待核实队列，需负责人独立核实后方可作为凭据");
      setShowEvidenceModal(false);
      setEvidenceContent("");
      setEvidenceSource("");
      setEvidenceNature("REAL");
      setEvidenceObtainedAt("");
      await reloadProject();
      await Promise.all([fetchEvidenceInsight(), fetchOpportunity()]);
    });
  };

  // P1-01/A2: 负责人独立核实或否决一条证据（仅 OWNER 可操作，服务端强制校验角色）
  const handleVerifyEvidence = async (evidenceId: string, status: "VERIFIED" | "REJECTED") => {
    await runMutation(async () => {
      await apiCall(`/api/evidences/${evidenceId}/verify`, "POST", { status });
      showMsg(status === "VERIFIED" ? "证据已独立核实，现可作为决策凭据" : "证据已否决");
      await reloadProject();
      await Promise.all([fetchEvidenceInsight(), fetchOpportunity()]);
    });
  };

  // P1-02: OWNER 录入市场验证并置状态（服务端仅 OWNER + 只允许负责人手动确认，不以模型评分替代）
  const handleSubmitValidation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validationEvidenceId) {
      showMsg("请选择已核实证据", "error");
      return;
    }
    await runMutation(async () => {
      await apiCall(`/api/projects/${project.id}/opportunity`, "PATCH", {
          evidenceId: validationEvidenceId,
          validation: {
            sampleSize: validationSampleSize || undefined,
            timeRange: validationTimeRange || undefined,
            limitations: validationLimitations || undefined,
          },
          status: validationStatus,
      });
      showMsg("市场验证已保存");
      setShowValidationModal(false);
      setValidationEvidenceId("");
      setValidationSampleSize("");
      setValidationTimeRange("");
      setValidationLimitations("");
      await fetchOpportunity();
      await reloadProject();
    });
  };

  // 5. Submit Feedback
  const handleCreateFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackContent.trim()) return;
    await runMutation(async () => {
      await apiCall(`/api/projects/${project.id}/feedback`, "POST", {
        targetType: "Project",
        targetId: project.id,
        content: feedbackContent,
      });
      showMsg("反馈提交成功");
      setFeedbackContent("");
      await reloadProject();
    });
  };

  // 6. Dispose Feedback
  const handleDisposeFeedback = async (feedbackId: string, status: "ACCEPTED" | "REJECTED") => {
    if (savingRef.current) return;
    const reason = await askReason(
      status === "ACCEPTED"
        ? { title: "采纳反馈并立项修订", label: "采纳意见并建立修订工作项说明", placeholder: "填写采纳意见，将作为修订工作项说明…", confirmText: "采纳并立项", tone: "primary" }
        : { title: "驳回反馈", label: "驳回反馈理由", placeholder: "填写驳回理由…", confirmText: "确认驳回", tone: "danger" }
    );
    if (!reason) return;
    await runMutation(async () => {
      await apiCall(`/api/feedback/${feedbackId}/disposition`, "POST", {
        status,
        reason,
        createRevisionWorkItem: status === "ACCEPTED",
      });
      showMsg("反馈已处置");
      await reloadProject();
    });
  };

  const handlePrepareProduction = async () => {
    await runMutation(async () => {
      await apiCall(`/api/projects/${project.id}/production/prepare`, "POST");
      showMsg("已进入生产准备并补齐 G2 准备任务；这不代表生产已获批");
      await reloadProject();
    });
  };

  const handleRequestG2 = async () => {
    await runMutation(async () => {
      await apiCall(`/api/projects/${project.id}/production/g2`, "POST");
      showMsg("正式 G2 已提交，等待指定决策人审批");
      await reloadProject();
    });
  };

  const handleProductionStart = async () => {
    if (savingRef.current) return;
    const note = await askReason({
      title: "确认实际生产开工",
      label: "实际开工说明",
      placeholder: "填写工厂排产/开工/首批投料等真实动作…",
      confirmText: "确认开工",
      tone: "primary",
    });
    if (!note) return;
    await runMutation(async () => {
      await apiCall(`/api/projects/${project.id}/production/start`, "POST", { note });
      showMsg("已记录真实开工，项目进入商业化生产阶段");
      await reloadProject();
    });
  };

  const handleProductionDelivery = async () => {
    if (savingRef.current) return;
    const note = await askReason({
      title: "确认生产交付",
      label: "实际交付说明",
      placeholder: "填写批次完成、出库/入仓/签收等真实交付说明…",
      confirmText: "确认交付",
      tone: "primary",
    });
    if (!note) return;
    await runMutation(async () => {
      await apiCall(`/api/projects/${project.id}/production/deliver`, "POST", { note });
      showMsg("生产交付已确认，项目进入已交付阶段");
      await reloadProject();
    });
  };

  // 7. Create & Submit Decision Packet
  const handleCreateAndSubmitPacket = async (e: React.FormEvent) => {
    e.preventDefault();
    await runMutation(async () => {
      const budgetAmount = preparePacketBudget(packetBudget);
      if (!packetScope.trim() || !packetPlan.trim()) {
        throw new Error("请填写实际授权动作范围和打样验证计划");
      }
      const evidences = project.evidences.map((e: any) => ({ id: e.id, hash: e.hash }));
      const artifacts = project.workItems.flatMap((w: any) =>
        w.artifacts.map((a: any) => ({ type: a.type, version: a.contentVersion }))
      );

      const packet = await apiCall(`/api/projects/${project.id}/decision-packets`, "POST", {
        budgetAmount,
        budgetScope: packetScope.trim(),
        validationPlan: packetPlan.trim(),
        artifactVersions: artifacts,
        evidenceVersions: evidences,
      });

      // Directly freeze & submit
      await apiCall(`/api/decision-packets/${packet.id}/submit`, "POST");
      showMsg("打样门决策包已起草并冻结提交审查");
      setShowPacketModal(false);
      await reloadProject();
    });
  };

  // 8. Decide Gate
  const handleDecideGate = async (packetId: string, decision: string) => {
    if (savingRef.current) return;
    const reason = await askReason(
      decision === "APPROVE"
        ? { title: "批准决策包", label: "请输入批准理由", placeholder: "填写批准理由…", confirmText: "批准", tone: "primary" }
        : { title: "退回修改", label: "请输入退回/修改理由", placeholder: "填写退回或修改理由…", confirmText: "退回修改", tone: "danger" }
    );
    if (!reason) return;
    await runMutation(async () => {
      const res = await apiCall(`/api/decision-packets/${packetId}/decide`, "POST", {
        decision,
        reason,
        idempotencyKey: `idemp-${Date.now()}`,
      });
      const decidedPacket = (project.decisionPackets ?? []).find((p: any) => p.id === packetId);
      // 推进结果只认服务端返回：阶段和后续任务都可能因门禁/模式约束没有发生，
      // 客户端照剧本宣布「已推进至 SAMPLING 并生成任务」就是在替后端编结果。
      const newStage: string | null = res?.project?.stage ?? null;
      const nextWorkItemTitle: string | null = res?.nextWorkItem?.title ?? null;
      showMsg(
        decision === "APPROVE"
          ? decidedPacket?.gate === "PRODUCTION_GATE"
            ? "正式 G2 已批准；项目仍停在生产准备，真实开工需另行确认"
            : [
                "研发打样门已批准。",
                newStage ? `项目当前阶段：${labelProjectStage(newStage)}。` : "",
                nextWorkItemTitle ? `已生成后续任务「${nextWorkItemTitle}」。` : "",
              ]
                .filter(Boolean)
                .join("")
          : "已做出决策"
      );
      await reloadProject();
    });
  };

  const stages = projectStagesForMode(project.mode);

  // 阶段步进条：状态取自项目阶段枚举；标签一律经 status-labels 中文化（禁止裸渲染英文枚举）。
  const currentStageIdx = stages.indexOf(project.stage);
  const stepItems: StepItem[] = stages.map((st, idx) => {
    const state: StepItem["state"] =
      project.stage === st ? "current" : currentStageIdx > idx ? "done" : currentStageIdx < 0 ? "unknown" : "pending";
    return {
      key: st,
      label: labelProjectStage(st),
      state,
      // 只有当前阶段是实测事实。更早的阶段只能说「已走过」——
      // 这里没有逐阶段的完成记录，说「已完成」是从数组下标推出来的断言。
      note:
        project.stage === st
          ? st === "DELIVERED" ? "已交付" : "当前进行中"
          : state === "done"
            ? "已走过"
            : state === "unknown"
              ? "阶段未知"
              : "未开始",
    };
  });

  // G1 / G2 都走统一 DecisionPacket。批准只代表授权，实际打样/生产动作由后续命令记录。
  const researchPacket = (project.decisionPackets || []).find(
    (p: any) => p.gate === "RESEARCH_SAMPLING_GATE"
  );
  const productionPacket = (project.decisionPackets || []).find(
    (p: any) => p.gate === "PRODUCTION_GATE"
  );
  const gateState = (packet: any): GateNode["state"] =>
    !packet
      ? "not-created"
      : packet.status === "APPROVED"
        ? "passed"
        : packet.status === "DRAFT" || packet.status === "IN_REVIEW"
          ? "pending"
          : "blocked";
  const allGateNodes: GateNode[] = [
    {
      key: "G1",
      label: "研发打样门",
      state: gateState(researchPacket),
      source: "decision-packet",
      detail: researchPacket ? labelDecisionPacketStatus(researchPacket.status) : undefined,
      refId: researchPacket?.id ?? null,
    },
    {
      key: "G2",
      label: "生产投入门",
      state: gateState(productionPacket),
      source: "decision-packet",
      detail: productionPacket ? labelDecisionPacketStatus(productionPacket.status) : undefined,
      refId: productionPacket?.id ?? null,
    },
  ];
  const gateNodes = project.mode === "FIXED_PRODUCT" ? allGateNodes.filter((gate) => gate.key === "G2") : allGateNodes;

  return (
    <AppShell
      active="products"
      user={{ name: currentSession?.userName, meta: currentSession?.userEmail }}
      runtime={runtime}
      topbarRight={
        mockAuth ? (
          <div className="hermes-identity">
            <span>当前模拟操作身份（开发态）</span>
            <select
              value={activeUserId}
              onChange={(e) => setActiveUserId(e.target.value)} disabled={saving}
              aria-label="切换操作人"
            >
              {allUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} {u.id === project.ownerId ? "(负责人 PM)" : u.id === project.decisionMakerId ? "(决策人 VP)" : "(成员)"}
                </option>
              ))}
            </select>
          </div>
        ) : undefined
      }
    >
      <PageHeading
        eyebrow="产品工作区"
        title={
          <>
            {project.title} <small>r{project.revision}</small>
          </>
        }
        subtitle={project.target}
        actions={
          <Link href="/products" className="hermes-outline-btn">
            <Icon name="back" size={16} />
            返回产品
          </Link>
        }
      />

      <div className="hermes-stack">
        {/* Global Toast Alert：成功 5 秒后淡出（计时见 showMsg），失败常驻可关（KX-28 Notice） */}
        <Notice
          msg={message ? { tone: message.type === "error" ? "danger" : "ok", text: message.text } : null}
          onClose={() => setMessage(null)}
          autoHideMs={0}
        />

        {reasonDialog}

        {/* Project Header Card + Stage Progression Pipeline */}
        <Panel
          eyebrow={`模式 · ${labelProjectMode(project.mode)}`}
          title={
            <>
              {project.title} <small>r{project.revision}</small>
            </>
          }
          sub={project.target}
          actions={
            <div className="hermes-inline">
              <span className="hermes-chip">负责人 {project.owner?.name || "未指定"}</span>
              <span className="hermes-chip">决策人 {project.decisionMaker?.name || "未指定"}</span>
            </div>
          }
        >
          <div className="hermes-section-label">项目阶段流程</div>
          <StepTrack steps={stepItems} ariaLabel="项目阶段进度" />
        </Panel>

        {/* Gaps & Readiness Alert */}
        {currentGaps.length > 0 && (
          <div className="hermes-panel" style={{ borderColor: "var(--warn-line)", background: "var(--warn-bg)" }}>
            <div className="hermes-panel-head is-stacked">
              <span className="hermes-section-label" style={{ color: "var(--warn-ink)" }}>
                研发打样门缺口诊断
              </span>
              <strong style={{ color: "var(--warn-ink)", fontSize: 12 }}>必须解决后方可批准</strong>
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: "var(--warn-ink)", lineHeight: 1.8 }}>
              {currentGaps.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </div>
        )}

        <div ref={workspaceTabsRef} className="hermes-workspace-tabs" role="tablist" aria-label="项目工作区" data-morph="tabs">
          {PROJECT_WORKSPACE_TABS.map(([key, label], index) => (
            <button
              key={key}
              id={`project-tab-${key}`}
              type="button"
              role="tab"
              tabIndex={activeWorkspaceTab === key ? 0 : -1}
              aria-selected={activeWorkspaceTab === key}
              aria-controls="project-workspace-panel"
              className={`hermes-workspace-tab ${activeWorkspaceTab === key ? "is-active" : ""}`}
              onClick={() => setActiveWorkspaceTab(key)}
              onKeyDown={(event) => {
                const next = event.key === "ArrowRight" ? (index + 1) % PROJECT_WORKSPACE_TABS.length
                  : event.key === "ArrowLeft" ? (index - 1 + PROJECT_WORKSPACE_TABS.length) % PROJECT_WORKSPACE_TABS.length
                  : event.key === "Home" ? 0
                  : event.key === "End" ? PROJECT_WORKSPACE_TABS.length - 1 : null;
                if (next === null) return;
                event.preventDefault();
                setActiveWorkspaceTab(PROJECT_WORKSPACE_TABS[next][0]);
                const tab = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];
                tab?.focus();
                tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
              }}
            >
              {label}
              {key === "tasks" && project.workItems.length > 0 ? <span>{project.workItems.length}</span> : null}
              {key === "evidence" && project.evidences.length > 0 ? <span>{project.evidences.length}</span> : null}
              {key === "decisions" && project.decisionPackets.length > 0 ? <span>{project.decisionPackets.length}</span> : null}
            </button>
          ))}
        </div>

        <div ref={workspacePanelRef} id="project-workspace-panel" role="tabpanel" aria-labelledby={`project-tab-${activeWorkspaceTab}`} tabIndex={0}>
        {activeWorkspaceTab === "overview" && (
          <OverviewRoleBased project={project} gaps={currentGaps} evidenceInsight={evidenceInsight} opportunity={opportunity} onTabChange={setActiveWorkspaceTab} />
                  )}

        {activeWorkspaceTab === "overview-old" && (
          <div className="hermes-workspace-overview">
            <Panel
              eyebrow="NEXT ACTION"
              title="现在最重要的事"
              sub={
                currentGaps.length > 0
                  ? `还有 ${currentGaps.length} 个研发/决策缺口需要先解决`
                  : productRndWorkItem?.id
                    ? "研发工作流已经建立，可以查看 AI 团队进度与管理报告"
                    : "当前没有研发阻断，可以继续安排下一项工作"
              }
              actions={
                productRndWorkItem?.id ? (
                  <button type="button" className="hermes-primary-btn hermes-btn-sm" onClick={() => setActiveWorkspaceTab("rnd")}>
                    查看 AI 研发
                    <Icon name="arrow" size={14} />
                  </button>
                ) : (
                  <button type="button" className="hermes-primary-btn hermes-btn-sm" onClick={() => setActiveWorkspaceTab("tasks")}>
                    查看工作项
                    <Icon name="arrow" size={14} />
                  </button>
                )
              }
            >
              <div className="hermes-workspace-summary">
                <button type="button" onClick={() => setActiveWorkspaceTab("tasks")}>
                  <span>工作项</span>
                  <strong>{project.workItems.length}</strong>
                  <small>执行与交付</small>
                </button>
                <button type="button" onClick={() => setActiveWorkspaceTab("evidence")}>
                  <span>已核实证据</span>
                  <strong>{project.evidences.filter((e: any) => e.verifyStatus === "VERIFIED").length}</strong>
                  <small>共 {project.evidences.length} 条依据</small>
                </button>
                <button type="button" onClick={() => setActiveWorkspaceTab("decisions")}>
                  <span>待裁决</span>
                  <strong>{project.decisionPackets.filter((p: any) => p.status === "IN_REVIEW").length}</strong>
                  <small>共 {project.decisionPackets.length} 个决策包</small>
                </button>
                <button type="button" onClick={() => setActiveWorkspaceTab("records")}>
                  <span>协作反馈</span>
                  <strong>{project.feedbackItems?.length ?? 0}</strong>
                  <small>修订与留痕</small>
                </button>
              </div>
              {currentGaps.length > 0 ? (
                <div className="hermes-overview-gaps">
                  <strong>优先补齐</strong>
                  <ul>
                    {currentGaps.slice(0, 4).map((gap, index) => <li key={index}>{gap}</li>)}
                  </ul>
                  {currentGaps.length > 4 ? <span>另有 {currentGaps.length - 4} 项未展开</span> : null}
                </div>
              ) : (
                <div className="hermes-note">
                  当前没有研发打样门阻断。继续推进前仍需以最新证据和正式门禁结果为准。
                </div>
              )}
            </Panel>
          </div>
        )}

        {activeWorkspaceTab === "rnd" && (<>
        {/* AI 产品研发：数字员工流水线 + 结构化 Executive Report */}
        {productRndWorkItem?.id ? (
          <ProductRndPanel
            projectId={project.id}
            workItemId={productRndWorkItem.id}
            mockAuth={mockAuth}
            activeUserId={activeUserId}
            canOperate={isOwner || isDecisionMaker}
            onChanged={reloadProject}
            onNotice={(text: string, type: "ok" | "error") =>
              showMsg(text, type === "error" ? "error" : "success")
            }
            onOpenDecisions={() => setActiveWorkspaceTab("decisions")}
            onOpenEvidence={() => setActiveWorkspaceTab("evidence")}
          />
        ) : (
          <Panel title="AI 研发">
            <Empty>当前产品还没有建立“产品研发综合评估”工作项。可以先在工作项页建立，或从 Kern 发起一轮研发。</Empty>
          </Panel>
        )}
        </>)}

        {activeWorkspaceTab === "cost" && (
          <div className="hermes-workspace-cost">
            <CostCalculatorModular productName={project.title} productCategory={project.category || "保健品"} />
          </div>
        )}

        {activeWorkspaceTab === "evidence" && (<>
        {/* P1-01: 证据覆盖与缺口（统一证据结构：仅已核实 FACT 计入结论，缺口保持 UNKNOWN） */}
        {evidenceInsight && (
          <Panel eyebrow="证据洞察" title="证据覆盖与缺口 (P1-01)">
            {evidenceInsight.resolved.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div className="hermes-subheading" style={{ color: "var(--ok-ink)" }}>
                  已核实的关键结论 (仅 VERIFIED FACT)
                </div>
                <ul className="hermes-list">
                  {evidenceInsight.resolved.map((r: any, i: number) => (
                    <li key={i} className="hermes-row is-flat">
                      <span className="hermes-row-body">
                        {r.fieldKey}: <strong>{r.value}</strong>
                        {r.unit ? ` ${r.unit}` : ""}
                        {r.mechanism ? ` (${r.mechanism})` : ""}{" "}
                        <span className="hermes-row-meta">— {r.source}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {evidenceInsight.conflicts.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div className="hermes-subheading" style={{ color: "var(--warn-ink)" }}>
                  冲突资料并列 ({evidenceInsight.conflicts.length})
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-2)", lineHeight: 1.7 }}>
                  {evidenceInsight.conflicts.map((cg: any[], gi: number) => (
                    <div key={gi} style={{ marginBottom: 4 }}>
                      {cg.map((c: any) => (
                        <span key={c.evidenceId + c.value} style={{ marginRight: 8 }}>
                          {c.fieldKey}={c.value}
                          {c.selectionReason ? ` (选用: ${c.selectionReason})` : ""}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {evidenceInsight.gaps.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div className="hermes-subheading" style={{ color: "var(--block-ink)" }}>
                  数据缺口 ({evidenceInsight.gaps.length}) — 缺失保持 UNKNOWN，不自动补成事实
                </div>
                <ul className="hermes-list">
                  {evidenceInsight.gaps.map((g: any, i: number) => (
                    <li key={i} className="hermes-row is-flat">
                      <span className="hermes-row-body">
                        {g.fieldName}: {g.description}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {evidenceInsight.gaps.length === 0 && evidenceInsight.resolved.length === 0 && (
              <div className="hermes-note">暂无证据。录入证据并经负责人核实后自动汇总关键结论与缺口。</div>
            )}
          </Panel>
        )}

        {/* P1-02: 机会分析与市场验证（证据驱动机会类型 + 八要素三态分列 + 市场验证 + 阻断缺口） */}
        {opportunity && (
          <Panel
            eyebrow="机会分析"
            title="机会分析与市场验证 (P1-02)"
            actions={
              isOwner ? (
                <button disabled={saving} onClick={() => { setMessage(null); setShowValidationModal(true); }} className="hermes-primary-btn hermes-btn-sm">
                  <Icon name="plus" size={15} />
                  录入市场验证
                </button>
              ) : undefined
            }
          >
            <div className="hermes-inline" style={{ marginBottom: 10 }}>
              <span className="hermes-note">机会类型:</span>
              <Badge tone="ok">{labelOpportunityType(opportunity.type)}</Badge>
              {opportunity.followingHitRequiresSalesVolume && (
                <span style={{ color: "var(--warn-ink)", fontSize: 11 }}>(爆品跟进机会，需核实销量后方可推进打样)</span>
              )}
            </div>

            {opportunity.blockingKeyGaps.length > 0 && (
              <div className="hermes-banner is-danger" style={{ marginBottom: 10 }}>
                <strong>关键证据缺口未闭合，阻断打样决策：</strong>
                {opportunity.blockingKeyGaps.join("、")}。请补足并核实后再推进。
              </div>
            )}

            {opportunity.elements.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div className="hermes-subheading">八要素 (事实 / 推断 / 假设 三态分列)</div>
                <div className="hermes-list">
                  {opportunity.elements.map((el: any) => (
                    <div key={el.key} className="hermes-row is-flat">
                      <div className="hermes-row-title" style={{ color: "var(--ok-ink)" }}>
                        {labelOpportunityElement(el.key)}
                      </div>
                      {el.fact.length > 0 && (
                        <div className="hermes-row-body">
                          <span style={{ fontWeight: 600, color: "var(--ok)" }}>事实:</span> {el.fact.join("； ")}
                        </div>
                      )}
                      {el.inference.length > 0 && (
                        <div className="hermes-row-body" style={{ color: "var(--warn-ink)" }}>
                          <span style={{ fontWeight: 600 }}>推断:</span> {el.inference.join("； ")}
                        </div>
                      )}
                      {el.assumption.length > 0 && (
                        <div className="hermes-row-body" style={{ color: "var(--ink-faint)" }}>
                          <span style={{ fontWeight: 600 }}>假设:</span> {el.assumption.join("； ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {opportunity.basis?.policy?.length > 0 && (
              <div className="hermes-note" style={{ marginBottom: 10 }}>
                <strong>政策/趋势线索:</strong> {opportunity.basis.policy.join("； ")}
              </div>
            )}

            {opportunity.validations.length > 0 ? (
              <div>
                <div className="hermes-subheading">市场验证记录 (负责人手动确认)</div>
                <ul className="hermes-list">
                  {opportunity.validations.map((v: any) => (
                    <li key={v.evidenceId} className="hermes-row is-flat">
                      <span className="hermes-row-body">
                        <strong>{labelValidationStatus(v.status)}</strong>
                        {v.sampleSize ? ` · 样本: ${v.sampleSize}` : ""}
                        {v.timeRange ? ` · 时间: ${v.timeRange}` : ""}
                        {v.limitations ? ` · 局限: ${v.limitations}` : ""}
                        {v.claims.length > 0
                          ? ` · ${v.claims.map((c: any) => `${c.key}=${c.value}${c.kind === "FACT" ? "" : "(推断)"}`).join(", ")}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="hermes-note">尚未取得真实市场验证。验证必须由负责人手动确认，禁止以模型评分替代。</div>
            )}
          </Panel>
        )}

        {/* P1-02: 市场验证录入弹窗（仅负责人） */}
        {showValidationModal && (
          <Modal
            eyebrow="P1-02"
            title="录入市场验证"
            sub="仅负责人可提交；验证状态由负责人手动确认，不以模型评分替代真实验证。"
            onClose={() => { if (!savingRef.current) setShowValidationModal(false); }}
            wide
          >
            <form onSubmit={handleSubmitValidation} className="hermes-form-grid" aria-busy={saving}>{formError}
              <label className="hermes-label">
                <span>选择已核实证据</span>
                <select
                  className="hermes-select" disabled={saving}
                  value={validationEvidenceId}
                  onChange={(e) => setValidationEvidenceId(e.target.value)}
                >
                  <option value="">— 选择证据 —</option>
                  {(project.evidences || [])
                    .filter((evi: any) => evi.verifyStatus === "VERIFIED")
                    .map((evi: any) => (
                      <option key={evi.id} value={evi.id}>
                        {evi.source}: {(evi.contentOrUri || "资料").slice(0, 28)}
                      </option>
                    ))}
                </select>
              </label>
              <label className="hermes-label">
                <span>样本规模</span>
                <input
                  className="hermes-input" disabled={saving}
                  value={validationSampleSize}
                  onChange={(e) => setValidationSampleSize(e.target.value)}
                  placeholder="如：50 名目标用户 / 30 天渠道销售"
                />
              </label>
              <label className="hermes-label">
                <span>时间范围</span>
                <input
                  className="hermes-input" disabled={saving}
                  value={validationTimeRange}
                  onChange={(e) => setValidationTimeRange(e.target.value)}
                  placeholder="如：2026-08-01 ~ 2026-08-30"
                />
              </label>
              <label className="hermes-label">
                <span>局限</span>
                <input
                  className="hermes-input" disabled={saving}
                  value={validationLimitations}
                  onChange={(e) => setValidationLimitations(e.target.value)}
                  placeholder="如：样本集中于华东，未覆盖华南"
                />
              </label>
              <label className="hermes-label">
                <span>验证状态</span>
                <select
                  className="hermes-select" disabled={saving}
                  value={validationStatus}
                  onChange={(e) => setValidationStatus(e.target.value)}
                >
                  <option value="IN_PROGRESS">{labelValidationStatus("IN_PROGRESS")}</option>
                  <option value="VERIFIED_BY_LEAD">{labelValidationStatus("VERIFIED_BY_LEAD")}</option>
                </select>
              </label>
              <div className="hermes-modal-actions">
                <button type="submit" className="hermes-primary-btn" disabled={saving}>
                  {saving ? "正在保存…" : "保存"}
                </button>
                <button type="button" className="hermes-outline-btn" disabled={saving} onClick={() => setShowValidationModal(false)}>
                  取消
                </button>
              </div>
            </form>
          </Modal>
        )}

        </>)}

        {activeWorkspaceTab === "decisions" && (<>
        {(project.stage === "SAMPLING" ||
          project.stage === "PRODUCTION_PREP" ||
          project.stage === "PRODUCTION" ||
          project.stage === "DELIVERED") && (
          <Panel
            eyebrow="G2 · PRODUCTION"
            title="生产投入与执行"
            sub="样品通过 → 生产准备 → G2 正式授权 → 真实开工 → 真实交付；批准不等于已生产"
          >
            <GateLine gates={[gateNodes[1]]} ariaLabel="G2 生产投入门禁" />

            {productionContext?.preparation && project.stage === "SAMPLING" && (
              <div className={`hermes-banner ${productionContext.preparation.ready ? "" : "is-warn"}`} style={{ marginTop: 10 }}>
                {productionContext.preparation.ready
                  ? "当前样品与版本已满足进入生产准备的前置条件。"
                  : `进入生产准备仍有 ${productionContext.preparation.blockers?.length ?? 0} 项阻断：${(productionContext.preparation.blockers ?? []).join("；")}`}
              </div>
            )}

            {productionContext?.gate && project.stage === "PRODUCTION_PREP" && (
              <>
                <div className={`hermes-banner ${productionContext.gate.ready ? "" : "is-warn"}`} style={{ marginTop: 10 }}>
                  {productionContext.gate.ready
                    ? "正式 G2 输入已齐：当前版本、有效报价、样品/适用确认、包装、专业确认与生产计划均可验证。"
                    : `G2 尚有 ${productionContext.gate.blockers?.length ?? 0} 项阻断。`}
                </div>
                {!productionContext.gate.ready && (
                  <ul className="hermes-list" style={{ marginTop: 8 }}>
                    {(productionContext.gate.blockers ?? []).map((b: string, i: number) => (
                      <li key={i} className="hermes-row is-flat">{b}</li>
                    ))}
                  </ul>
                )}
              </>
            )}

            <div className="hermes-inline-end" style={{ marginTop: 12 }}>
              {isOwner && project.stage === "SAMPLING" && (
                <button
                  className="hermes-primary-btn"
                  onClick={handlePrepareProduction}
                  disabled={saving || !productionContext?.preparation?.ready}
                >
                  样品闭环，进入生产准备
                </button>
              )}
              {isOwner &&
                project.stage === "PRODUCTION_PREP" &&
                productionPacket?.status !== "APPROVED" &&
                productionPacket?.status !== "IN_REVIEW" && (
                  <button
                    className="hermes-primary-btn"
                    onClick={handleRequestG2}
                    disabled={saving || !productionContext?.gate?.ready}
                  >
                    提交正式 G2 审批
                  </button>
                )}
              {productionPacket?.status === "IN_REVIEW" && (
                <span className="hermes-note">
                  G2 已送审，等待指定决策人处理；负责人不能自批。
                </span>
              )}
              {isOwner && project.stage === "PRODUCTION_PREP" && productionPacket?.status === "APPROVED" && (
                <button disabled={saving} className="hermes-primary-btn" onClick={handleProductionStart}>
                  确认实际开工
                </button>
              )}
              {isOwner && project.stage === "PRODUCTION" && (
                <button disabled={saving} className="hermes-primary-btn" onClick={handleProductionDelivery}>
                  确认生产交付
                </button>
              )}
              {project.stage === "DELIVERED" && <Badge status="VERIFIED" tone="ok">生产已交付</Badge>}
            </div>
            <p className="viz-source-note">
              G2 批准后仍停留在“生产准备”；只有记录真实开工才进入“商业化生产”，真实生产记录验收后才能进入“已交付”。
            </p>
          </Panel>
        )}

        {/* 1. Decision Gate Section */}
        <Panel
          eyebrow="GOVERNANCE"
          title="正式门禁决策包"
          sub={project.mode === "FIXED_PRODUCT" ? "指定产品以 G2 冻结生产投入快照，由指定决策人裁决；负责人禁止自批" : "G1 与 G2 均冻结不可变快照，由指定决策人裁决；负责人禁止自批"}
          actions={
            isOwner && (project.stage === "DRAFT" || project.stage === "RESEARCH") ? (
              <button disabled={saving} onClick={() => { setMessage(null); setShowPacketModal(true); }} className="hermes-primary-btn hermes-btn-sm">
                <Icon name="plus" size={15} />
                起草/重提决策包
              </button>
            ) : undefined
          }
        >
          <GateLine gates={gateNodes} ariaLabel="项目门禁线" />
          <p className="viz-source-note">
            {project.mode === "FIXED_PRODUCT" ? "指定产品从生产准备开始，G2 批准允许投入生产。" : "G1 批准允许投入打样；G2 批准允许投入生产。"}授权不等于实际执行完成，真实开工/交付另行记录。
          </p>
          {project.decisionPackets.length === 0 ? (
            <Empty>暂无决策包。由负责人起草打样门方案并冻结提交。</Empty>
          ) : (
            <div className="hermes-list">
              {project.decisionPackets
                .filter((pkt: any) => pkt.gate === "RESEARCH_SAMPLING_GATE" || pkt.gate === "PRODUCTION_GATE")
                .map((pkt: any) => {
                const pktTone =
                  pkt.status === "CHANGES_REQUESTED"
                    ? "danger"
                    : pkt.status === "APPROVED"
                    ? "ok"
                    : pkt.status === "IN_REVIEW"
                    ? "warn"
                    : "neutral";
                return (
                  <div key={pkt.id} className="hermes-row">
                    <div className="hermes-row-head" style={{ justifyContent: "space-between" }}>
                      <div className="hermes-inline">
                        <Badge tone={pktTone}>{pkt.gate === "PRODUCTION_GATE" ? "G2 生产投入门" : "G1 研发打样门"}</Badge>
                        <Badge tone={pktTone}>{labelDecisionPacketStatus(pkt.status)}</Badge>
                        <span className="hermes-mono">指纹: {pkt.scopeHash.slice(0, 16)}...</span>
                      </div>
                      <span className="hermes-row-meta">提交于: {fmtTime(pkt.createdAt)}</span>
                    </div>

                    <div className="hermes-kv" style={{ marginTop: 8 }}>
                      <dt>拟投入预算</dt>
                      <dd>
                        <strong style={{ color: "var(--ok)" }}>¥{pkt.budgetAmount?.toLocaleString() || "未确定"}</strong>
                      </dd>
                      <dt>授权动作范围</dt>
                      <dd>{pkt.budgetScope || "未填写"}</dd>
                      <dt>打样验证计划</dt>
                      <dd>{pkt.validationPlan}</dd>
                    </div>

                    {/* Decision Maker Approval Action Bar */}
                    {pkt.status === "IN_REVIEW" && (
                      <div
                        className="hermes-inline"
                        style={{ justifyContent: "space-between", marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 8 }}
                      >
                        <span className="hermes-row-meta">
                          {isDecisionMaker ? (
                            <span style={{ color: "var(--ok)", fontWeight: 600 }}>
                              您是指定决策人，可执行{pkt.gate === "PRODUCTION_GATE" ? "生产投入门" : "研发打样门"}裁决
                            </span>
                          ) : isOwner ? (
                            <span style={{ color: "var(--block-ink)", fontWeight: 600 }}>负责人禁止自批，等待指定决策人审批 (A05)</span>
                          ) : (
                            <span>等待指定决策人审批</span>
                          )}
                        </span>
                        <div className="hermes-inline">
                          <button
                            onClick={() => handleDecideGate(pkt.id, "REQUEST_CHANGES")}
                            className="hermes-danger-btn hermes-btn-sm"
                            disabled={saving || !isDecisionMaker}
                          >
                            退回修改
                          </button>
                          <button
                            onClick={() => handleDecideGate(pkt.id, "APPROVE")}
                            className="hermes-primary-btn hermes-btn-sm"
                            disabled={saving || !isDecisionMaker}
                          >
                            {pkt.gate === "PRODUCTION_GATE" ? "批准 G2（授权生产投入）" : "批准 G1（推进至打样）"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Decision History */}
                    {pkt.decisions?.length > 0 && (
                      <div style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
                        <div className="hermes-row-meta" style={{ fontWeight: 600, marginBottom: 4 }}>
                          决策与义务留痕:
                        </div>
                        {pkt.decisions.map((dec: any) => (
                          <div key={dec.id} className="hermes-row is-flat" style={{ padding: "6px 10px" }}>
                            <span className="hermes-row-body">
                              <strong>{dec.actor?.name}</strong>: {dec.decision} - {dec.reason}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        </>)}

        {activeWorkspaceTab === "tasks" && (<>
        {/* 2. Work Items Section */}
        <Panel
          eyebrow="执行"
          title={`工作项与交付成果 (${project.workItems.length})`}
          sub="安排工作项、提交交付物与负责人核实验收"
          actions={
            isOwner ? (
              <button disabled={saving} onClick={() => { setMessage(null); setShowWorkModal(true); }} className="hermes-primary-btn hermes-btn-sm">
                <Icon name="plus" size={15} />
                安排工作项
              </button>
            ) : undefined
          }
        >
          {project.workItems.length === 0 ? (
            <Empty>暂无工作项。由负责人点击右上角「安排工作项」建立第一项工作，或从 Kern 发起研发后生成执行工作。</Empty>
          ) : (
            <div className="hermes-list">
              {project.workItems.map((item: any) => {
                const wiTone =
                  item.status === "ACCEPTED"
                    ? "ok"
                    : item.status === "CHANGES_REQUESTED"
                    ? "danger"
                    : item.status === "SUBMITTED"
                    ? "warn"
                    : "neutral";
                return (
                  <div key={item.id} className="hermes-row">
                    <div className="hermes-row-head" style={{ justifyContent: "space-between" }}>
                      <span className="hermes-row-title">{item.title}</span>
                      <Badge tone={wiTone}>{labelWorkItemStatus(item.status)}</Badge>
                    </div>
                    <p className="hermes-row-body">{item.target}</p>
                    <div className="hermes-row-meta">
                      交付要求: <em>{item.deliverableReq}</em>
                    </div>

                    {/* F03: 依赖阻塞状态 —— 前置依赖未验收时当前项视为阻塞，不可进入执行 */}
                    {(item.dependencies?.length || 0) > 0 && (
                      <div className="hermes-row is-flat" style={{ marginTop: 6 }}>
                        <div className="hermes-row-meta" style={{ fontWeight: 600 }}>
                          前置依赖 (F03):
                        </div>
                        {item.dependencies.map((depId: string) => {
                          const dep = workItemById.get(depId);
                          const depDone = dep?.status === "ACCEPTED";
                          return (
                            <div key={depId} className="hermes-inline" style={{ fontSize: 11 }}>
                              <span
                                style={{
                                  display: "inline-block",
                                  width: 7,
                                  height: 7,
                                  borderRadius: "50%",
                                  background: depDone ? "var(--ok)" : "var(--block-ink)",
                                }}
                              />
                              <span>{dep?.title || "（已删除的依赖）"}</span>
                              <span
                                className="hermes-row-meta"
                                style={{ marginLeft: "auto", color: depDone ? "var(--ok)" : "var(--block-ink)", fontWeight: 600 }}
                              >
                                {depDone ? "已完成" : "未验收 · 阻塞"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {item.dependencies?.length > 0 && item.status === "TODO" && !item.dependencies.every((d: string) => {
                      const dep = workItemById.get(d);
                      return dep?.status === "ACCEPTED";
                    }) && (
                      <div className="hermes-banner is-danger" style={{ marginTop: 6 }}>
                        ⏳ 存在未验收的前置依赖，本任务当前处于<b>阻塞</b>状态，待依赖完成后解除。
                      </div>
                    )}

                    {/* Artifacts Display */}
                    {item.artifacts?.length > 0 && (
                      <div className="hermes-row is-flat" style={{ marginTop: 6 }}>
                        <div className="hermes-row-meta" style={{ fontWeight: 600 }}>
                          已提交交付物产物:
                        </div>
                        {item.artifacts.map((a: any) => (
                          <div key={a.id} className="hermes-row-body">
                            <span style={{ fontWeight: 600, color: "var(--accent-hover)" }}>[{a.producerType}] {a.title}:</span>{" "}
                            <span className="hermes-mono">id: {a.id}</span>{" "}
                            <ArtifactContent id={a.id} content={a.content ?? ""} />
                          </div>
                        ))}
                      </div>
                    )}

                    {/* B01-03 审核提示：本次变化 / 沿用成果 / 尚未确认内容 */}
                    {(() => {
                      const latestSubmission = item.submissions?.[0];
                      const changed = (item.artifacts || []).filter((a: any) => a.reviewStatus === "PENDING");
                      const carried = (item.applicabilities || []).filter((ap: any) => ap.submissionId === latestSubmission?.id);
                      const unconfirmed = [
                        ...changed.map((a: any) => `新成果 ${a.type} v${a.contentVersion} 尚未经负责人检查`),
                        ...carried
                          .filter((ap: any) => ap.status !== "CONFIRMED")
                          .map(
                            (ap: any) =>
                              `沿用成果 ${ap.artifact?.type ?? "成果"} v${ap.artifact?.contentVersion}（原始输入基线 r${ap.sourceInputRevision}）尚未确认适用于当前基线 r${ap.baselineRevision}`
                          ),
                      ];
                      if (!changed.length && !carried.length) return null;

                      return (
                        <div className="hermes-row" style={{ marginTop: 6, borderColor: "var(--warn-line)", background: "var(--warn-bg)" }}>
                          <div className="hermes-row-meta" style={{ color: "var(--warn-ink)", fontWeight: 600 }}>
                            第 {latestSubmission?.attempt ?? "?"} 批审核提示（确认前请逐项核对）
                          </div>

                          {changed.length > 0 && (
                            <div className="hermes-row-body" style={{ color: "var(--warn-ink)" }}>
                              <span style={{ fontWeight: 600 }}>本次变化：</span>
                              {changed.map((a: any) => `${a.type} v${a.contentVersion}（待检查）`).join("、")}
                            </div>
                          )}

                          {carried.length > 0 && (
                            <div className="hermes-row-body" style={{ color: "var(--warn-ink)" }}>
                              <span style={{ fontWeight: 600 }}>沿用成果（未重新生成）：</span>
                              {carried
                                .map(
                                  (ap: any) =>
                                    `${ap.artifact?.type ?? "成果"} v${ap.artifact?.contentVersion}，原始输入基线 r${ap.sourceInputRevision} → 适用于当前基线 r${ap.baselineRevision}（${
                                      ap.status === "CONFIRMED"
                                        ? `已由 ${ap.confirmedBy?.name ?? "负责人"} 确认`
                                        : ap.status === "REJECTED"
                                        ? "已被否决"
                                        : "待负责人确认"
                                    }）`
                                )
                                .join("；")}
                            </div>
                          )}

                          {unconfirmed.length > 0 && (
                            <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 11, color: "var(--warn-ink)", lineHeight: 1.7 }}>
                              {unconfirmed.map((text: string, idx: number) => (
                                <li key={idx}>{text}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })()}

                    {/* F05: 运行回执 (RunReceipt) —— 每次运行的历史回执，含运行方式/结果/耗时/错误 */}
                    {(item.receipts?.length || 0) > 0 && (
                      <div className="hermes-row is-flat" style={{ marginTop: 6 }}>
                        <div className="hermes-row-meta" style={{ fontWeight: 600 }}>
                          运行回执 ({item.receipts.length}) <span style={{ fontWeight: 400, color: "var(--ink-faint)" }}>— 每次产出均有回执留痕</span>
                        </div>
                        {item.receipts.map((r: any) => {
                          const failed = r.status === "FAILED";
                          const cancelled = r.status === "CANCELLED";
                          return (
                            <div
                              key={r.id}
                              className="hermes-inline"
                              style={{ fontSize: 11, borderTop: "1px solid var(--line)", paddingTop: 4, marginTop: 4 }}
                            >
                              <Badge tone={failed || cancelled ? "danger" : "ok"}>{labelAgentRunStatus(r.status)}</Badge>
                              <span className="hermes-mono">#{r.attempt} r{r.inputRevision}</span>
                              <span>{labelRunMode(r.runMode)}</span>
                              <span className="hermes-row-meta" style={{ marginLeft: "auto" }}>
                                {fmtTime(r.startedAt)}
                                {failed && r.errorMessage ? ` · ${r.errorMessage.slice(0, 36)}` : ""}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Work Item Actions */}
                    <div className="hermes-inline" style={{ justifyContent: "space-between", marginTop: 8 }}>
                      <button disabled={saving} onClick={() => { setMessage(null); setShowSubmissionModal(item.id); }} className="hermes-link">
                        + 提交产物成果
                      </button>
                      {isOwner && item.status === "SUBMITTED" && (
                        <div className="hermes-inline">
                          <button disabled={saving} onClick={() => handleReviewWorkItem(item.id, false)} className="hermes-danger-btn hermes-btn-sm">
                            退回修改
                          </button>
                          <button disabled={saving} onClick={() => handleReviewWorkItem(item.id, true)} className="hermes-primary-btn hermes-btn-sm">
                            检查通过 (Accept)
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        </>)}

        {activeWorkspaceTab === "evidence" && (<>
        {/* Evidence Vault */}
        <Panel
          eyebrow="证据与依据"
          title="证据与依据 (REAL/DEMO)"
          sub="可信市场与研报来源"
          actions={
            <button disabled={saving} onClick={() => { setMessage(null); setShowEvidenceModal(true); }} className="hermes-primary-btn hermes-btn-sm">
              <Icon name="plus" size={15} />
              添加证据
            </button>
          }
        >
          {project.evidences.length === 0 ? (
            <Empty>暂无证据资料。点击「录入依据证据」登记来源并完成核实；未核实内容不会作为正式门禁依据。</Empty>
          ) : (
            <div className="hermes-list">
              {project.evidences.map((evi: any) => (
                <div key={evi.id} className="hermes-row">
                  <div className="hermes-row-head">
                    <Badge tone={evi.nature === "REAL" ? "ok" : "warn"}>{labelEvidenceNature(evi.nature)}</Badge>
                    <Badge status={evi.verifyStatus}>{labelEvidenceVerifyStatus(evi.verifyStatus)}</Badge>
                    <span className="hermes-mono hermes-row-meta">{evi.hash.slice(0, 10)}...</span>
                  </div>
                  <div className="hermes-row-title">{evi.contentOrUri}</div>
                  <div className="hermes-row-meta" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                    <span>来源: {evi.source}</span>
                    {evi.obtainedAt && <span>采集: {fmtDateTime(evi.obtainedAt)}</span>}
                    {evi.verifiedBy?.name && <span>核实人: {evi.verifiedBy.name}</span>}
                  </div>
                  {evi.claims?.length > 0 && (
                    <div style={{ marginTop: 6, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
                      {evi.claims.map((cl: any) => (
                        <div key={cl.id} className="hermes-inline" style={{ fontSize: 11, marginBottom: 4 }}>
                          <Badge tone={cl.kind === "FACT" ? "ok" : cl.kind === "INFERENCE" ? "info" : "neutral"}>{labelEvidenceClaimKind(cl.kind)}</Badge>
                          <span className="hermes-row-body">
                            {cl.fieldKey}: <strong>{cl.value}</strong>
                            {cl.unit ? ` ${cl.unit}` : ""}
                            {cl.mechanism ? ` (${cl.mechanism})` : ""}
                            {cl.conflictGroup ? ` [冲突组:${cl.conflictGroup}]` : ""}
                          </span>
                        </div>
                      ))}
                      {evi.claims.some((cl: any) => cl.selectionReason) && (
                        <div className="hermes-row-meta" style={{ color: "var(--warn-ink)", fontStyle: "italic", fontSize: 11 }}>
                          选用理由: {evi.claims.find((cl: any) => cl.selectionReason)?.selectionReason}
                        </div>
                      )}
                    </div>
                  )}
                  {isOwner && evi.verifyStatus === "UNVERIFIED" && (
                    <div className="hermes-inline" style={{ marginTop: 6 }}>
                      <button disabled={saving} onClick={() => handleVerifyEvidence(evi.id, "VERIFIED")} className="hermes-primary-btn hermes-btn-sm">
                        核实
                      </button>
                      <button disabled={saving} onClick={() => handleVerifyEvidence(evi.id, "REJECTED")} className="hermes-danger-btn hermes-btn-sm">
                        否决
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>

        </>)}

        {activeWorkspaceTab === "records" && (<>
        {/* Collaboration & Feedback */}
        <Panel eyebrow="协作" title="协作反馈与修订闭环">
          <form onSubmit={handleCreateFeedback} className="hermes-form-grid" aria-busy={saving}>{formError}
            <textarea
              className="hermes-textarea" disabled={saving}
              aria-label="反馈内容"
              required
              value={feedbackContent}
              onChange={(e) => setFeedbackContent(e.target.value)}
              placeholder="提交针对方案、口感或成分的反馈..."
            />
            <button type="submit" className="hermes-outline-btn" disabled={saving}>
              发表反馈
            </button>
          </form>

          <div className="hermes-list" style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
            {project.feedbackItems?.map((fb: any) => (
              <div key={fb.id} className="hermes-row is-flat">
                <div className="hermes-row-head" style={{ justifyContent: "space-between" }}>
                  <strong>{fb.author?.name}</strong>
                  <Badge status={fb.status}>{labelFeedbackStatus(fb.status)}</Badge>
                </div>
                <p className="hermes-row-body">{fb.content}</p>
                {fb.dispositionReason && (
                  <div className="hermes-row-meta" style={{ color: "var(--accent-hover)", background: "var(--accent-wash)", padding: 4, borderRadius: 6 }}>
                    处置: {fb.dispositionReason}
                  </div>
                )}
                {isOwner && fb.status === "OPEN" && (
                  <div className="hermes-inline" style={{ justifyContent: "flex-end", marginTop: 4 }}>
                    <button disabled={saving} onClick={() => handleDisposeFeedback(fb.id, "REJECTED")} className="hermes-ghost-btn hermes-btn-sm">
                      驳回
                    </button>
                    <button disabled={saving} onClick={() => handleDisposeFeedback(fb.id, "ACCEPTED")} className="hermes-link">
                      采纳并立项修订
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>

        </>)}

        </div>
        {/* Modals stay outside tabs so open forms are not destroyed by tab navigation. */}
        {/* Modal: Create Work Item */}
        {showWorkModal && (
          <Modal eyebrow="工作项" title="安排新工作项" onClose={() => { if (!savingRef.current) setShowWorkModal(false); }} wide>
            <form onSubmit={handleCreateWorkItem} className="hermes-form-grid" aria-busy={saving}>{formError}
              <label className="hermes-label">
                <span>工作项名称</span>
                <input
                  type="text"
                  required
                  className="hermes-input" disabled={saving}
                  value={workTitle}
                  onChange={(e) => setWorkTitle(e.target.value)}
                  placeholder={TENANT_UI.workTitlePlaceholder}
                />
              </label>
              <label className="hermes-label">
                <span>执行目标</span>
                <input
                  type="text"
                  required
                  className="hermes-input" disabled={saving}
                  value={workTarget}
                  onChange={(e) => setWorkTarget(e.target.value)}
                  placeholder="例如: 测定80度烤制30分钟后的留存率"
                />
              </label>
              <label className="hermes-label">
                <span>明确交付物要求</span>
                <textarea
                  required
                  rows={2}
                  className="hermes-textarea" disabled={saving}
                  value={workDeliverable}
                  onChange={(e) => setWorkDeliverable(e.target.value)}
                  placeholder="例如: 实验报告PDF及多酚留存率数据表"
                />
              </label>
              <label className="hermes-label">
                <span>执行方式 (F05)</span>
                <select className="hermes-select" disabled={saving} value={workExecutorType} onChange={(e) => setWorkExecutorType(e.target.value)}>
                  <option value="HUMAN">{labelWorkExecutorType("HUMAN")}</option>
                  <option value="TEST_AGENT">{labelWorkExecutorType("TEST_AGENT")}</option>
                  <option value="DIGITAL_WORKER">{labelWorkExecutorType("DIGITAL_WORKER")}</option>
                </select>
              </label>
              <div className="hermes-label">
                <span>前置依赖工作项 (F03，可多选)</span>
                <div className="hermes-row is-flat" style={{ maxHeight: 120, overflowY: "auto", padding: 6 }}>
                  {project.workItems.length === 0 ? (
                    <span className="hermes-row-meta">暂无其他任务可选</span>
                  ) : (
                    project.workItems.map((pwi: any) => (
                      <label key={pwi.id} className="hermes-inline" style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          disabled={saving}
                          checked={workDependencies.includes(pwi.id)}
                          onChange={(e) =>
                            setWorkDependencies((prev) =>
                              e.target.checked ? [...prev, pwi.id] : prev.filter((id) => id !== pwi.id)
                            )
                          }
                        />
                        <span>{pwi.title}</span>
                        <span className="hermes-row-meta" style={{ marginLeft: "auto" }}>
                          {labelWorkItemStatus(pwi.status)}
                        </span>
                      </label>
                    ))
                  )}
                </div>
                <span className="hermes-note" style={{ marginTop: 4 }}>
                  前置依赖未验收时，本任务将标记为阻塞，待依赖完成后解除。
                </span>
              </div>
              <div className="hermes-modal-actions">
                <button type="button" className="hermes-outline-btn" disabled={saving} onClick={() => setShowWorkModal(false)}>
                  取消
                </button>
                <button type="submit" className="hermes-primary-btn" disabled={saving}>
                  {saving ? "正在创建…" : "确认创建"}
                </button>
              </div>
            </form>
          </Modal>
        )}

        {/* Modal: Submit Deliverables */}
        {showSubmissionModal && (
          <Modal eyebrow="交付" title="提交产物成果" onClose={() => { if (!savingRef.current) setShowSubmissionModal(null); }} wide>
            <form onSubmit={(event) => { event.preventDefault(); void handleSubmitDeliverables(showSubmissionModal); }} className="hermes-form-grid" aria-busy={saving}>
              {formError}
              <label className="hermes-label">
                <span>运行方式标记 (真实性约束)</span>
                <select className="hermes-select" disabled={saving} value={subRunMode} onChange={(e) => setSubRunMode(e.target.value)}>
                  <option value="MANUAL">{labelRunMode("MANUAL")}</option>
                  <option value="TEST_STUB">{labelRunMode("TEST_STUB")}</option>
                </select>
              </label>
              <label className="hermes-label">
                <span>成果类型</span>
                <select
                  className="hermes-select" disabled={saving}
                  value={subArtifactType}
                  onChange={(e) => {
                    const type = e.target.value;
                    setSubArtifactType(type);
                  }}
                >
                  <option value="RESEARCH_REPORT">{labelArtifactType("RESEARCH_REPORT")}</option>
                  <option value="SAMPLE_ROUND">{labelArtifactType("SAMPLE_ROUND")}</option>
                  <option value="SUPPLIER_QUOTE">{labelArtifactType("SUPPLIER_QUOTE")}</option>
                  <option value="PROFESSIONAL_CONFIRMATION">{labelArtifactType("PROFESSIONAL_CONFIRMATION")}</option>
                  <option value="PACKAGING_BRIEF">{labelArtifactType("PACKAGING_BRIEF")}</option>
                  <option value="PRODUCTION_PLAN">{labelArtifactType("PRODUCTION_PLAN")}</option>
                  <option value="PRODUCTION_RECORD">{labelArtifactType("PRODUCTION_RECORD")}</option>
                  <option value="COST_SCENARIO">{labelArtifactType("COST_SCENARIO")}</option>
                </select>
              </label>
              {STRUCTURED_SUBMISSION_TYPES.has(subArtifactType) && (
                <div className="hermes-note">
                  <button type="button" className="hermes-outline-btn hermes-btn-sm" disabled={saving || !!subArtifactContent.trim()} onClick={() => setSubArtifactContent(structuredTemplate(subArtifactType))}>
                    插入 JSON 示例模板
                  </button>
                  <p>示例默认标记为演示数据（DEMO）。请填写实际成果并核实数据性质后提交；已有内容不会被模板覆盖。</p>
                </div>
              )}
              <label className="hermes-label">
                <span>产物标题</span>
                <input
                  type="text"
                  required
                  className="hermes-input" disabled={saving}
                  value={subArtifactTitle}
                  onChange={(e) => setSubArtifactTitle(e.target.value)}
                  placeholder="例如: 留存率测定报告"
                />
              </label>
              <label className="hermes-label">
                <span>{STRUCTURED_SUBMISSION_TYPES.has(subArtifactType) ? "结构化 JSON 内容" : "产物核心内容"}</span>
                <textarea
                  required
                  rows={3}
                  className="hermes-textarea" disabled={saving}
                  value={subArtifactContent}
                  onChange={(e) => setSubArtifactContent(e.target.value)}
                  placeholder={STRUCTURED_SUBMISSION_TYPES.has(subArtifactType)
                    ? "结构化成果使用 JSON；服务端会校验字段、REAL/DEMO、版本与缺失输入"
                    : "输入分析结论、测定数值或方案内容..."}
                />
              </label>
              <div className="hermes-modal-actions">
                <button type="button" className="hermes-outline-btn" disabled={saving} onClick={() => setShowSubmissionModal(null)}>
                  取消
                </button>
                <button type="submit" className="hermes-primary-btn" disabled={saving}>
                  {saving ? "正在提交…" : "确认提交"}
                </button>
              </div>
            </form>
          </Modal>
        )}

        {/* Modal: Add Evidence */}
        {showEvidenceModal && (
          <Modal eyebrow="证据" title="录入依据证据" onClose={() => { if (!savingRef.current) setShowEvidenceModal(false); }} wide>
            <form onSubmit={handleAddEvidence} className="hermes-form-grid" aria-busy={saving}>{formError}
              <label className="hermes-label">
                <span>证据性质 (REAL vs DEMO 强隔离)</span>
                <select className="hermes-select" disabled={saving} value={evidenceNature} onChange={(e) => setEvidenceNature(e.target.value)}>
                  <option value="REAL">{labelEvidenceNature("REAL")}</option>
                  <option value="DEMO">{labelEvidenceNature("DEMO")}</option>
                </select>
              </label>
              <label className="hermes-label">
                <span>证据内容或摘要</span>
                <textarea
                  required
                  rows={2}
                  className="hermes-textarea" disabled={saving}
                  value={evidenceContent}
                  onChange={(e) => setEvidenceContent(e.target.value)}
                  placeholder="例如: 2026年低糖多酚麦片在抖音电商热销增长率研报"
                />
              </label>
              <label className="hermes-label">
                <span>数据来源渠道</span>
                <input
                  type="text"
                  required
                  className="hermes-input" disabled={saving}
                  value={evidenceSource}
                  onChange={(e) => setEvidenceSource(e.target.value)}
                  placeholder="例如: 蝉妈妈电商数据平台 / 实验室质检"
                />
              </label>
              <label className="hermes-label">
                <span>采集时间 (留空则按录入时刻)</span>
                <input
                  type="datetime-local"
                  className="hermes-input" disabled={saving}
                  value={evidenceObtainedAt}
                  onChange={(e) => setEvidenceObtainedAt(e.target.value)}
                />
              </label>
              <div className="hermes-modal-actions">
                <button type="button" className="hermes-outline-btn" disabled={saving} onClick={() => setShowEvidenceModal(false)}>
                  取消
                </button>
                <button type="submit" className="hermes-primary-btn" disabled={saving}>
                  {saving ? "正在保存…" : "存入证据库"}
                </button>
              </div>
            </form>
          </Modal>
        )}

        {/* Modal: Draft Decision Packet */}
        {showPacketModal && (
          <Modal eyebrow="P0" title="起草研发打样门决策包 (P0)" onClose={() => { if (!savingRef.current) setShowPacketModal(false); }} wide>
            <form onSubmit={handleCreateAndSubmitPacket} className="hermes-form-grid" aria-busy={saving}>{formError}
              <label className="hermes-label">
                <span>拟投入预算金额 (元)</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  className="hermes-input" disabled={saving}
                  value={packetBudget}
                  onChange={(e) => setPacketBudget(e.target.value)}
                />
              </label>
              <label className="hermes-label">
                <span>授权动作范围 (严禁无限定范围)</span>
                <input
                  type="text"
                  required
                  className="hermes-input" disabled={saving}
                  value={packetScope}
                  onChange={(e) => setPacketScope(e.target.value)}
                />
              </label>
              <label className="hermes-label">
                <span>打样验证计划</span>
                <textarea
                  required
                  rows={2}
                  className="hermes-textarea" disabled={saving}
                  value={packetPlan}
                  onChange={(e) => setPacketPlan(e.target.value)}
                />
              </label>
              <div className="hermes-note" style={{ background: "var(--accent-wash)", padding: 8, borderRadius: 6 }}>
                💡 提交后将自动绑定当前有效成果与证据版本生成不可变快照与 scopeHash。
              </div>
              <div className="hermes-modal-actions">
                <button type="button" className="hermes-outline-btn" disabled={saving} onClick={() => setShowPacketModal(false)}>
                  取消
                </button>
                <button type="submit" className="hermes-primary-btn" disabled={saving}>
                  {saving ? "正在提交…" : "冻结并提交审批"}
                </button>
              </div>
            </form>
          </Modal>
        )}
      </div>
    </AppShell>
  );
}
