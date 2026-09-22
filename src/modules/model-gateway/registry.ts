import type {
  ModelProfile,
  ModelProviderPlugin,
} from "./types";

export class ModelRegistry {
  private readonly profiles = new Map<string, ModelProfile>();
  private readonly providers = new Map<string, ModelProviderPlugin>();

  registerProfile(profile: ModelProfile): void {
    if (!profile.id.trim()) throw new Error("ModelProfile.id 不能为空");
    if (!profile.provider.trim()) throw new Error("ModelProfile.provider 不能为空");
    if (!profile.modelId.trim()) throw new Error("ModelProfile.modelId 不能为空");
    this.profiles.set(profile.id, { ...profile, capabilities: [...profile.capabilities] });
  }

  registerProvider(plugin: ModelProviderPlugin): void {
    if (!plugin.provider.trim()) throw new Error("ModelProviderPlugin.provider 不能为空");
    this.providers.set(plugin.provider, plugin);
  }

  getProfile(id: string): ModelProfile | null {
    return this.profiles.get(id) ?? null;
  }

  listProfiles(): ModelProfile[] {
    return [...this.profiles.values()].map((profile) => ({
      ...profile,
      capabilities: [...profile.capabilities],
    }));
  }

  getProvider(provider: string): ModelProviderPlugin | null {
    return this.providers.get(provider) ?? null;
  }
}
