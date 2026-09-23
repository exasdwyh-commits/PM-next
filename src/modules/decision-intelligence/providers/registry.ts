import type {
  DecisionEngineKind,
  DecisionSpec,
} from "../types";
import type { JudgmentProvider } from "./types";

export interface JudgmentProviderSelection {
  preferredProviderKey?: string;
  preferredEngine?: DecisionEngineKind;
}

export class JudgmentProviderRegistry {
  private readonly providers = new Map<string, JudgmentProvider>();

  register(provider: JudgmentProvider): void {
    const key = provider.key.trim();
    if (!key) throw new Error("JudgmentProvider.key is required");
    if (this.providers.has(key)) {
      throw new Error(`Judgment provider already registered: ${key}`);
    }
    this.providers.set(key, provider);
  }

  has(key: string): boolean {
    return this.providers.has(key);
  }

  get(key: string): JudgmentProvider {
    const provider = this.providers.get(key);
    if (!provider) throw new Error(`Judgment provider not found: ${key}`);
    return provider;
  }

  list(): JudgmentProvider[] {
    return [...this.providers.values()];
  }

  select(
    spec: DecisionSpec,
    selection: JudgmentProviderSelection = {}
  ): JudgmentProvider | null {
    if (selection.preferredProviderKey) {
      const preferred = this.providers.get(selection.preferredProviderKey);
      if (!preferred) {
        throw new Error(
          `Judgment provider not found: ${selection.preferredProviderKey}`
        );
      }
      if (!spec.allowedEngines.includes(preferred.kind)) return null;
      return preferred.canHandle(spec) ? preferred : null;
    }

    const kinds: DecisionEngineKind[] =
      selection.preferredEngine &&
      spec.allowedEngines.includes(selection.preferredEngine)
        ? [
            selection.preferredEngine,
            ...spec.allowedEngines.filter(
              (kind) => kind !== selection.preferredEngine
            ),
          ]
        : [...spec.allowedEngines];

    for (const kind of kinds) {
      for (const provider of this.providers.values()) {
        if (provider.kind === kind && provider.canHandle(spec)) {
          return provider;
        }
      }
    }
    return null;
  }
}
