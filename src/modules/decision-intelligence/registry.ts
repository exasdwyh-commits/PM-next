import type { DecisionSpec } from "./types";

function id(key: string, version: string) {
  return `${key}@${version}`;
}

export class DecisionSpecRegistry {
  private readonly specs = new Map<string, DecisionSpec>();
  private readonly active = new Map<string, string>();

  register(spec: DecisionSpec, options: { active?: boolean } = {}): void {
    if (!spec.key.trim()) throw new Error("DecisionSpec.key is required");
    if (!spec.version.trim()) throw new Error("DecisionSpec.version is required");
    const specId = id(spec.key, spec.version);
    if (this.specs.has(specId)) {
      throw new Error(`DecisionSpec already registered: ${specId}`);
    }
    this.specs.set(specId, {
      ...spec,
      allowedEngines: [...spec.allowedEngines],
      allowedChoices: spec.allowedChoices ? [...spec.allowedChoices] : undefined,
      automation: { ...spec.automation },
    });
    if (options.active ?? true) {
      this.active.set(spec.key, spec.version);
    }
  }

  get(key: string, version?: string): DecisionSpec {
    const resolvedVersion = version ?? this.active.get(key);
    if (!resolvedVersion) {
      throw new Error(`No active DecisionSpec for ${key}`);
    }
    const spec = this.specs.get(id(key, resolvedVersion));
    if (!spec) throw new Error(`DecisionSpec not found: ${key}@${resolvedVersion}`);
    return {
      ...spec,
      allowedEngines: [...spec.allowedEngines],
      allowedChoices: spec.allowedChoices ? [...spec.allowedChoices] : undefined,
      automation: { ...spec.automation },
    };
  }

  setActive(key: string, version: string): void {
    if (!this.specs.has(id(key, version))) {
      throw new Error(`DecisionSpec not found: ${key}@${version}`);
    }
    this.active.set(key, version);
  }

  list(): DecisionSpec[] {
    return [...this.specs.values()].map((spec) => ({
      ...spec,
      allowedEngines: [...spec.allowedEngines],
      allowedChoices: spec.allowedChoices ? [...spec.allowedChoices] : undefined,
      automation: { ...spec.automation },
    }));
  }
}
