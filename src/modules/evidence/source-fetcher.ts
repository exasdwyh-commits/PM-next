import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { classifySourceUrl } from "./source-trust";
import { scanExternalText } from "./untrusted-content";

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface SourceFetchResponse {
  status: number;
  headers: Record<string, string | string[] | undefined> | { get(name: string): string | null };
  body: string;
  remoteAddress: string;
}

export type SourceResolver = (host: string) => Promise<ResolvedAddress[]>;
export type SourceRequest = (input: {
  url: string;
  pinned: ResolvedAddress[];
  maxBytes: number;
  timeoutMs: number;
}) => Promise<SourceFetchResponse>;

const ACCEPTED_MIME = new Set([
  "text/html",
  "text/plain",
  "application/json",
  "application/xhtml+xml",
]);

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(network, prefix, "ipv4");
blocked.addAddress("::", "ipv6");
blocked.addAddress("::1", "ipv6");
for (const [network, prefix] of [
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32],
] as const) blocked.addSubnet(network, prefix, "ipv6");

function normalizedIp(address: string): string {
  if (address.startsWith("::ffff:") && isIP(address.slice(7)) === 4) return address.slice(7);
  return address;
}

export function isPublicAddress(address: string): boolean {
  const normalized = normalizedIp(address);
  const family = isIP(normalized);
  if (!family) return false;
  return !blocked.check(normalized, family === 4 ? "ipv4" : "ipv6");
}

function headerValue(
  headers: SourceFetchResponse["headers"],
  name: string
): string | null {
  if (typeof (headers as { get?: unknown }).get === "function") {
    return (headers as { get(name: string): string | null }).get(name);
  }
  const map = headers as Record<string, string | string[] | undefined>;
  const value = map[name.toLowerCase()] ?? map[name];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function assertAllowedUrl(value: string) {
  const classified = classifySourceUrl(value);
  if (!classified.host) throw new Error("invalid-source-url");
  if (!["OFFICIAL", "PRIMARY", "REPUTABLE"].includes(classified.trustTier)) {
    throw new Error("source-domain-not-allowlisted");
  }
  return classified;
}

const defaultResolver: SourceResolver = async (host) => {
  const rows = await dnsLookup(host, { all: true, verbatim: true });
  return rows.map((row) => ({
    address: normalizedIp(row.address),
    family: (row.family === 6 ? 6 : 4) as 4 | 6,
  }));
};

async function resolvePinned(host: string, resolver: SourceResolver): Promise<ResolvedAddress[]> {
  const rows = await resolver(host);
  if (!rows.length) throw new Error("source-dns-empty");
  if (rows.some((row) => !isPublicAddress(row.address))) {
    throw new Error("source-address-not-public");
  }
  return rows;
}

const defaultRequest: SourceRequest = async ({ url, pinned, maxBytes, timeoutMs }) => {
  const target = new URL(url);
  const pin = pinned[0];
  if (!pin) throw new Error("source-dns-empty");

  return new Promise((resolve, reject) => {
    const request = https.request(target, {
      method: "GET",
      headers: {
        "user-agent": "PM-next-EvidenceFetcher/1.0",
        accept: "text/html,text/plain,application/json,application/xhtml+xml;q=0.9",
        "accept-encoding": "identity",
      },
      servername: target.hostname,
      lookup: (_hostname, options, callback) => {
        if (typeof options === "object" && options.all) {
          callback(null, pinned as never);
          return;
        }
        callback(null, pin.address, pin.family);
      },
    }, (response) => {
      const remoteAddress = normalizedIp(response.socket.remoteAddress ?? "");
      if (!isPublicAddress(remoteAddress) || !pinned.some((row) => row.address === remoteAddress)) {
        response.destroy();
        reject(new Error("source-remote-address-mismatch"));
        return;
      }

      const encoding = String(headerValue(response.headers, "content-encoding") ?? "identity").toLowerCase();
      if (encoding && encoding !== "identity") {
        response.resume();
        reject(new Error("source-compressed-content-rejected"));
        return;
      }

      const declared = Number(headerValue(response.headers, "content-length") ?? 0);
      if (declared && declared > maxBytes) {
        response.resume();
        reject(new Error("source-too-large"));
        return;
      }

      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        response.resume();
        resolve({ status, headers: response.headers, body: "", remoteAddress });
        return;
      }

      const contentType = String(headerValue(response.headers, "content-type") ?? "")
        .split(";")[0].trim().toLowerCase();
      if (!ACCEPTED_MIME.has(contentType)) {
        response.resume();
        reject(new Error("source-content-type-not-allowed"));
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          request.destroy(new Error("source-too-large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({
        status,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
        remoteAddress,
      }));
    });

    request.setTimeout(timeoutMs, () => request.destroy(new Error("source-timeout")));
    request.on("error", reject);
    request.end();
  });
};

export interface FetchedSource {
  requestedUrl: string;
  url: string;
  redirectCount: number;
  httpStatus: number;
  fetchedAt: string;
  contentHash: string;
  rawContentPreview: string;
  injectionScanResult: { quarantined: boolean; flags: string[] };
  sourceType: string;
  trustTier: string;
  sourceOrganization: string | null;
  host: string;
  remoteAddress: string;
  contentType: string;
}

export async function fetchTrustedSource(input: {
  url: string;
  resolver?: SourceResolver;
  request?: SourceRequest;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}): Promise<FetchedSource> {
  const resolver = input.resolver ?? defaultResolver;
  const request = input.request ?? defaultRequest;
  const timeoutMs = input.timeoutMs ?? 6000;
  const maxBytes = input.maxBytes ?? 131072;
  const maxRedirects = input.maxRedirects ?? 3;
  let currentUrl = input.url;
  let redirects = 0;

  while (true) {
    const classified = assertAllowedUrl(currentUrl);
    const pinned = await resolvePinned(classified.host!, resolver);
    const response = await request({ url: currentUrl, pinned, maxBytes, timeoutMs });
    const remoteAddress = normalizedIp(response.remoteAddress);

    if (!isPublicAddress(remoteAddress) || !pinned.some((row) => row.address === remoteAddress)) {
      throw new Error("source-remote-address-mismatch");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = headerValue(response.headers, "location");
      if (!location) throw new Error("redirect-without-location");
      if (redirects >= maxRedirects) throw new Error("too-many-redirects");
      currentUrl = new URL(location, currentUrl).toString();
      assertAllowedUrl(currentUrl);
      redirects += 1;
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error("source-http-status-not-success");
    }

    const encoding = String(headerValue(response.headers, "content-encoding") ?? "identity").toLowerCase();
    if (encoding && encoding !== "identity") throw new Error("source-compressed-content-rejected");

    const contentType = String(headerValue(response.headers, "content-type") ?? "")
      .split(";")[0].trim().toLowerCase();
    if (!ACCEPTED_MIME.has(contentType)) throw new Error("source-content-type-not-allowed");

    const raw = String(response.body ?? "");
    if (Buffer.byteLength(raw, "utf8") > maxBytes) throw new Error("source-too-large");
    if (!raw.trim()) throw new Error("source-empty-content");

    const scan = scanExternalText(raw);
    const finalClass = assertAllowedUrl(currentUrl);
    return {
      requestedUrl: input.url,
      url: currentUrl,
      redirectCount: redirects,
      httpStatus: response.status,
      fetchedAt: new Date().toISOString(),
      contentHash: createHash("sha256").update(raw, "utf8").digest("hex"),
      rawContentPreview: scan.text.slice(0, 12000),
      injectionScanResult: { quarantined: scan.quarantined, flags: scan.flags },
      sourceType: finalClass.sourceType,
      trustTier: scan.quarantined ? "QUARANTINED" : finalClass.trustTier,
      sourceOrganization: finalClass.organizationId,
      host: finalClass.host!,
      remoteAddress,
      contentType,
    };
  }
}
