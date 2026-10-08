import { AppError } from "@/shared/errors";

/**
 * P0-B Research Foundation - Source Fetcher
 * 硬化规则: HTTPS-only, host白名单, DNS解析, 拒绝 private/loopback/link-local/metadata, pin IP, 验证远程地址, 重定向校验, MIME白名单, 大小/超时, prompt-injection扫描, 隔离标记
 */

export interface SourceFetchInput {
  url: string;
  organizationId: string;
  missionId?: string;
  nodeKey?: string;
  maxSizeBytes?: number;
  timeoutMs?: number;
}

export interface SourceFetchOutput {
  url: string;
  finalUrl: string;
  statusCode: number;
  contentType: string;
  content: string;
  contentHash: string;
  fetchedAt: Date;
  trustTier: "OFFICIAL" | "REPUTABLE" | "COMMUNITY" | "UNTRUSTED";
  sourceOrganization: string;
  injectionStatus: "CLEAN" | "SUSPICIOUS" | "INJECTED";
  ip: string;
  dnsResolved: string[];
  redirectChain: string[];
  sizeBytes: number;
  mimeAllowed: boolean;
}

// This prototype has no real network transport. Do not publish mock sources as evidence.
export function assertSourceFetcherAvailable(): void {
  throw new AppError("来源抓取尚未接入真实网络服务，请使用现有研究流程。", "SOURCE_FETCH_UNAVAILABLE", 503);
}

export async function fetchSource(_input: SourceFetchInput): Promise<SourceFetchOutput> {
  throw new AppError("来源抓取尚未接入真实网络服务，请使用现有研究流程。", "SOURCE_FETCH_UNAVAILABLE", 503);
}

export function describeSourceFetcher() {
  return { available: false, mode: "unavailable", reason: "真实抓取服务尚未接入", capabilities: [] };
}
