export type DecisionOutputType = "BOOLEAN" | "CHOICE" | "SCORE";
export type DecisionRiskClass = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type DecisionEngineKind = "RULES" | "MODEL";
export type DecisionPolicyAction =
  | "AUTO"
  | "ESCALATE_AGENT"
  | "ESCALATE_HUMAN"
  | "BLOCK";
export type DecisionAutoPolicy =
  | "DISABLED"
  | "RULES_ONLY"
  | "BENCHMARKED_ENGINE";

export interface DecisionAutomationPolicy {
  autoPolicy: DecisionAutoPolicy;
  escalationTarget: "AGENT" | "HUMAN";
  minConfidence?: number;
  requireCalibrated?: boolean;
  requireBenchmarkProfile?: boolean;
}

export interface DecisionSpec {
  key: string;
  version: string;
  outputType: DecisionOutputType;
  riskClass: DecisionRiskClass;
  allowedEngines: DecisionEngineKind[];
  allowedChoices?: string[];
  minScore?: number;
  maxScore?: number;
  automation: DecisionAutomationPolicy;
  description?: string;
}

export interface DecisionRequest {
  decisionKey: string;
  specVersion?: string;
  state: unknown;
  criteria?: unknown;
  contextRefs: string[];
  language?: string;
}

export type DecisionValue = boolean | string | number;

export interface DecisionEngineResult {
  engine: DecisionEngineKind;
  engineVersion: string;
  /** Concrete runtime/provider provenance. Optional for deterministic rules. */
  providerKey?: string;
  providerVersion?: string;
  /** A provider may explicitly abstain; an abstention can never authorize AUTO. */
  abstained?: boolean;
  /** Optional provider/runtime fingerprint; persistence computes its own inputHash. */
  inputFingerprint?: string | null;
  value: DecisionValue;
  confidence: number | null;
  distribution?: Record<string, number> | null;
  reasonCodes: string[];
  latencyMs: number;
  calibrated: boolean;
  calibrationProfile: string | null;
  benchmarkProfile: string | null;
}

export interface DecisionPolicyResult {
  action: DecisionPolicyAction;
  reasons: string[];
}

export interface DecisionExecutionResult {
  spec: DecisionSpec;
  engineResult: DecisionEngineResult;
  policy: DecisionPolicyResult;
}

export interface DecisionEngine {
  readonly kind: DecisionEngineKind;
  readonly version: string;
  canHandle(spec: DecisionSpec): boolean;
  decide(spec: DecisionSpec, request: DecisionRequest): Promise<DecisionEngineResult>;
}
