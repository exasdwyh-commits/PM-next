"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Profile = {
  id: string;
  key: string;
  displayName: string;
  description: string | null;
  provider: string;
  modelId: string;
  capabilities: unknown;
  locality: string;
  health: string;
  enabled: boolean;
  qualityTier: string;
  latencyTier: string;
  costTier: string;
  contextWindow: number | null;
  dataPolicyNote: string | null;
  isPreset: boolean;
  runtimeConfigured: boolean;
};

type Policy = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  version: string;
  taskClass: string;
  candidates: unknown;
  requiredCapabilities: unknown;
  cloudAllowed: boolean;
  maxContextRequirement: number | null;
  isPreset: boolean;
};

type Agent = {
  id: string;
  code: string;
  name: string;
  roleKey: string;
  status: string;
};

type Binding = {
  id: string;
  agentId: string;
  taskClass: string;
  policyKey: string;
  agent: { code: string; name: string };
};

export type ModelControlOverview = {
  profiles: Profile[];
  policies: Policy[];
  agents: Agent[];
  bindings: Binding[];
  canManage: boolean;
  taskClasses: string[];
  capabilities: string[];
  presetCounts: { profiles: number; policies: number; bindings: number };
};

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function candidateList(value: unknown): Array<{ profileKey: string; priority: number }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.profileKey !== "string" || typeof row.priority !== "number") return [];
    return [{ profileKey: row.profileKey, priority: row.priority }];
  });
}

async function postAction(payload: Record<string, unknown>) {
  const response = await fetch("/api/model-control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error || body?.message || "模型配置保存失败");
  }
  return body;
}

function ProfileEditor({
  profile,
  canManage,
  onSaved,
}: {
  profile: Profile;
  canManage: boolean;
  onSaved: (message: string) => void;
}) {
  const [provider, setProvider] = useState(profile.provider);
  const [modelId, setModelId] = useState(profile.modelId);
  const [enabled, setEnabled] = useState(profile.enabled);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await postAction({
        action: "SAVE_PROFILE",
        key: profile.key,
        displayName: profile.displayName,
        description: profile.description,
        provider,
        modelId,
        capabilities: stringList(profile.capabilities),
        locality: profile.locality,
        health: profile.health,
        enabled,
        qualityTier: profile.qualityTier,
        latencyTier: profile.latencyTier,
        costTier: profile.costTier,
        contextWindow: profile.contextWindow,
        dataPolicyNote: profile.dataPolicyNote,
      });
      onSaved("已保存 " + profile.displayName);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hermes-row">
      <div className="hermes-row-head">
        <strong className="hermes-row-title">{profile.displayName}</strong>
        <span className="hermes-chip">{profile.key}</span>
        <span className="hermes-chip">
          {profile.qualityTier} · {profile.costTier}
        </span>
        <span className="hermes-chip">{profile.locality}</span>
        <span className={`hermes-chip ${profile.runtimeConfigured ? "is-ok" : ""}`}>
          {profile.runtimeConfigured ? "Runtime ready" : "Runtime missing"}
        </span>
      </div>
      <div className="hermes-row-body">
        {profile.description || "未填写说明"}
      </div>
      <div className="hermes-form-grid" style={{ marginTop: 10 }}>
        <label className="hermes-label">
          <span>Provider</span>
          <input
            className="hermes-input"
            value={provider}
            disabled={!canManage}
            onChange={(event) => setProvider(event.target.value)}
          />
        </label>
        <label className="hermes-label">
          <span>Model ID</span>
          <input
            className="hermes-input"
            value={modelId}
            disabled={!canManage}
            onChange={(event) => setModelId(event.target.value)}
          />
        </label>
      </div>
      <div className="hermes-inline" style={{ marginTop: 10 }}>
        <span className="hermes-note">
          能力：{stringList(profile.capabilities).join(" / ") || "未配置"}
        </span>
        <label className="hermes-inline" style={{ marginLeft: "auto" }}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canManage}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          启用
        </label>
        {canManage ? (
          <button
            type="button"
            className="hermes-outline-btn hermes-btn-sm"
            disabled={busy}
            onClick={save}
          >
            {busy ? "保存中…" : "保存 Profile"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function ModelControlClient({
  initial,
}: {
  initial: ModelControlOverview;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [profileForm, setProfileForm] = useState({
    key: "",
    displayName: "",
    provider: "",
    modelId: "",
    locality: "CLOUD",
    qualityTier: "BALANCED",
    latencyTier: "NORMAL",
    costTier: "STANDARD",
    capabilities: "TEXT,STRUCTURED_OUTPUT",
  });

  const [policyForm, setPolicyForm] = useState({
    key: "",
    name: "",
    taskClass: "PRODUCT_ANALYSIS",
    candidateKeys: "",
    requiredCapabilities: "TEXT,REASONING",
    cloudAllowed: true,
  });

  const [bindingForm, setBindingForm] = useState({
    agentId: initial.agents[0]?.id || "",
    taskClass: initial.taskClasses[0] || "QUICK_CLASSIFY",
    policyKey: "",
  });

  const matchingPolicies = useMemo(
    () => initial.policies.filter((policy) => policy.taskClass === bindingForm.taskClass),
    [initial.policies, bindingForm.taskClass]
  );

  function report(text: string) {
    setError(null);
    setMessage(text);
    router.refresh();
  }

  async function run(payload: Record<string, unknown>, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await postAction(payload);
      report(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="hermes-note">
        这里保存的是路由元数据，不保存 API Key。密钥继续放环境变量或后续 Secret Provider；
        未配置的官方 Profile 默认禁用，禁止静默切换到高价模型。
      </div>

      {message ? <div className="hermes-banner is-ok" style={{ marginTop: 10 }}>{message}</div> : null}
      {error ? <div className="hermes-banner is-danger" style={{ marginTop: 10 }}>{error}</div> : null}

      <div className="hermes-inline" style={{ marginTop: 12 }}>
        <strong>配置概览</strong>
        <span className="hermes-chip">Profile {initial.profiles.length}</span>
        <span className="hermes-chip">Policy {initial.policies.length}</span>
        <span className="hermes-chip">绑定 {initial.bindings.length}</span>
        {initial.canManage ? (
          <button
            type="button"
            className="hermes-primary-btn hermes-btn-sm"
            style={{ marginLeft: "auto" }}
            disabled={busy}
            onClick={() =>
              run(
                { action: "INSTALL_PRESETS" },
                "官方推荐模板已安装；已有自定义 provider/modelId 不会被覆盖"
              )
            }
          >
            安装官方推荐模板
          </button>
        ) : null}
      </div>

      <div className="hermes-section-label" style={{ marginTop: 16 }}>
        Model Profiles
      </div>
      {initial.profiles.length === 0 ? (
        <div className="hermes-empty">尚未创建 Profile。先安装官方模板，或由管理员创建自定义 Profile。</div>
      ) : (
        <div className="hermes-list">
          {initial.profiles.map((profile) => (
            <ProfileEditor
              key={profile.id}
              profile={profile}
              canManage={initial.canManage}
              onSaved={report}
            />
          ))}
        </div>
      )}

      {initial.canManage ? (
        <div className="hermes-row" style={{ marginTop: 12 }}>
          <div className="hermes-row-head">
            <strong className="hermes-row-title">新增自定义 Profile</strong>
          </div>
          <div className="hermes-form-grid">
            <label className="hermes-label">
              <span>Key</span>
              <input className="hermes-input" value={profileForm.key} onChange={(e) => setProfileForm({ ...profileForm, key: e.target.value })} />
            </label>
            <label className="hermes-label">
              <span>显示名称</span>
              <input className="hermes-input" value={profileForm.displayName} onChange={(e) => setProfileForm({ ...profileForm, displayName: e.target.value })} />
            </label>
            <label className="hermes-label">
              <span>Provider</span>
              <input className="hermes-input" value={profileForm.provider} onChange={(e) => setProfileForm({ ...profileForm, provider: e.target.value })} />
            </label>
            <label className="hermes-label">
              <span>Model ID</span>
              <input className="hermes-input" value={profileForm.modelId} onChange={(e) => setProfileForm({ ...profileForm, modelId: e.target.value })} />
            </label>
            <label className="hermes-label">
              <span>Capabilities（逗号分隔）</span>
              <input className="hermes-input" value={profileForm.capabilities} onChange={(e) => setProfileForm({ ...profileForm, capabilities: e.target.value })} />
            </label>
            <label className="hermes-label">
              <span>Locality</span>
              <select className="hermes-select" value={profileForm.locality} onChange={(e) => setProfileForm({ ...profileForm, locality: e.target.value })}>
                <option value="CLOUD">CLOUD</option>
                <option value="LOCAL">LOCAL</option>
              </select>
            </label>
          </div>
          <div className="hermes-inline-end" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="hermes-outline-btn hermes-btn-sm"
              disabled={busy}
              onClick={() =>
                run(
                  {
                    action: "SAVE_PROFILE",
                    ...profileForm,
                    capabilities: profileForm.capabilities.split(",").map((item) => item.trim()).filter(Boolean),
                    // 不从客户端断言 health：这个模型还没被探测过，
                    // 由服务端按 schema 默认值落库，健康度只在真实探测后才有意义。
                    enabled: false,
                    contextWindow: null,
                    dataPolicyNote: null,
                  },
                  "自定义 Profile 已创建"
                )
              }
            >
              创建 Profile
            </button>
          </div>
        </div>
      ) : null}

      <div className="hermes-section-label" style={{ marginTop: 18 }}>
        Task Policies
      </div>
      <div className="hermes-list">
        {initial.policies.map((policy) => (
          <div className="hermes-row" key={policy.id}>
            <div className="hermes-row-head">
              <strong className="hermes-row-title">{policy.name}</strong>
              <span className="hermes-chip">{policy.taskClass}</span>
              <span className="hermes-chip">{policy.key}</span>
              <span className="hermes-chip">{policy.cloudAllowed ? "Cloud OK" : "Local only"}</span>
            </div>
            <div className="hermes-row-body">
              {(policy.description || "未填写说明") + " · 候选：" +
                candidateList(policy.candidates)
                  .sort((a, b) => a.priority - b.priority)
                  .map((item) => item.profileKey + "@" + item.priority)
                  .join(" → ")}
            </div>
          </div>
        ))}
      </div>

      {initial.canManage ? (
        <div className="hermes-row" style={{ marginTop: 12 }}>
          <div className="hermes-row-head">
            <strong className="hermes-row-title">新增自定义 Policy</strong>
          </div>
          <div className="hermes-form-grid">
            <label className="hermes-label">
              <span>Key</span>
              <input className="hermes-input" value={policyForm.key} onChange={(e) => setPolicyForm({ ...policyForm, key: e.target.value })} />
            </label>
            <label className="hermes-label">
              <span>名称</span>
              <input className="hermes-input" value={policyForm.name} onChange={(e) => setPolicyForm({ ...policyForm, name: e.target.value })} />
            </label>
            <label className="hermes-label">
              <span>Task Class</span>
              <select className="hermes-select" value={policyForm.taskClass} onChange={(e) => setPolicyForm({ ...policyForm, taskClass: e.target.value })}>
                {initial.taskClasses.map((taskClass) => <option key={taskClass} value={taskClass}>{taskClass}</option>)}
              </select>
            </label>
            <label className="hermes-label">
              <span>候选 Profile Key（逗号分隔，顺序=优先级）</span>
              <input className="hermes-input" value={policyForm.candidateKeys} onChange={(e) => setPolicyForm({ ...policyForm, candidateKeys: e.target.value })} />
            </label>
            <label className="hermes-label">
              <span>Required Capabilities</span>
              <input className="hermes-input" value={policyForm.requiredCapabilities} onChange={(e) => setPolicyForm({ ...policyForm, requiredCapabilities: e.target.value })} />
            </label>
            <label className="hermes-inline">
              <input type="checkbox" checked={policyForm.cloudAllowed} onChange={(e) => setPolicyForm({ ...policyForm, cloudAllowed: e.target.checked })} />
              允许云模型
            </label>
          </div>
          <div className="hermes-inline-end" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="hermes-outline-btn hermes-btn-sm"
              disabled={busy}
              onClick={() => {
                const candidateKeys = policyForm.candidateKeys.split(",").map((item) => item.trim()).filter(Boolean);
                run(
                  {
                    action: "SAVE_POLICY",
                    key: policyForm.key,
                    name: policyForm.name,
                    version: "custom-v1",
                    taskClass: policyForm.taskClass,
                    candidates: candidateKeys.map((profileKey, index) => ({
                      profileKey,
                      priority: (index + 1) * 10,
                    })),
                    requiredCapabilities: policyForm.requiredCapabilities.split(",").map((item) => item.trim()).filter(Boolean),
                    cloudAllowed: policyForm.cloudAllowed,
                    maxContextRequirement: null,
                  },
                  "自定义 Policy 已创建"
                );
              }}
            >
              创建 Policy
            </button>
          </div>
        </div>
      ) : null}

      <div className="hermes-section-label" style={{ marginTop: 18 }}>
        Agent × TaskClass Bindings
      </div>
      {initial.bindings.length === 0 ? (
        <div className="hermes-empty">尚未绑定 Agent 模型策略。</div>
      ) : (
        <div className="hermes-list is-2col">
          {initial.bindings.map((binding) => (
            <div className="hermes-row" key={binding.id}>
              <div className="hermes-row-head">
                <strong className="hermes-row-title">{binding.agent.name}</strong>
                <span className="hermes-chip">{binding.taskClass}</span>
              </div>
              <div className="hermes-row-body">{binding.policyKey}</div>
            </div>
          ))}
        </div>
      )}

      {initial.canManage ? (
        <div className="hermes-row" style={{ marginTop: 12 }}>
          <div className="hermes-form-grid">
            <label className="hermes-label">
              <span>Agent</span>
              <select className="hermes-select" value={bindingForm.agentId} onChange={(e) => setBindingForm({ ...bindingForm, agentId: e.target.value })}>
                {initial.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.roleKey}</option>)}
              </select>
            </label>
            <label className="hermes-label">
              <span>Task Class</span>
              <select
                className="hermes-select"
                value={bindingForm.taskClass}
                onChange={(e) => setBindingForm({ agentId: bindingForm.agentId, taskClass: e.target.value, policyKey: "" })}
              >
                {initial.taskClasses.map((taskClass) => <option key={taskClass} value={taskClass}>{taskClass}</option>)}
              </select>
            </label>
            <label className="hermes-label">
              <span>Policy</span>
              <select className="hermes-select" value={bindingForm.policyKey} onChange={(e) => setBindingForm({ ...bindingForm, policyKey: e.target.value })}>
                <option value="">选择同 TaskClass 策略</option>
                {matchingPolicies.map((policy) => <option key={policy.id} value={policy.key}>{policy.name} · {policy.key}</option>)}
              </select>
            </label>
          </div>
          <div className="hermes-inline-end" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="hermes-primary-btn hermes-btn-sm"
              disabled={busy || !bindingForm.agentId || !bindingForm.policyKey}
              onClick={() => run({ action: "BIND_AGENT", ...bindingForm }, "Agent 模型策略绑定已保存")}
            >
              保存绑定
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
