export interface SourceClassification {
  sourceType: "OFFICIAL" | "PRIMARY" | "REPUTABLE" | "EXTERNAL";
  trustTier: "OFFICIAL" | "PRIMARY" | "REPUTABLE" | "UNRATED";
  organizationId: string | null;
  host: string | null;
}

const SOURCES: Record<string, Omit<SourceClassification, "host">> = {
  "fda.gov": { sourceType: "OFFICIAL", trustTier: "OFFICIAL", organizationId: "FDA" },
  "www.fda.gov": { sourceType: "OFFICIAL", trustTier: "OFFICIAL", organizationId: "FDA" },
  "nih.gov": { sourceType: "OFFICIAL", trustTier: "OFFICIAL", organizationId: "NIH" },
  "www.nih.gov": { sourceType: "OFFICIAL", trustTier: "OFFICIAL", organizationId: "NIH" },
  "clinicaltrials.gov": { sourceType: "OFFICIAL", trustTier: "OFFICIAL", organizationId: "NIH" },
  "www.clinicaltrials.gov": { sourceType: "OFFICIAL", trustTier: "OFFICIAL", organizationId: "NIH" },
  "ncbi.nlm.nih.gov": { sourceType: "PRIMARY", trustTier: "PRIMARY", organizationId: "NIH" },
  "pubmed.ncbi.nlm.nih.gov": { sourceType: "PRIMARY", trustTier: "PRIMARY", organizationId: "NIH" },
  "who.int": { sourceType: "OFFICIAL", trustTier: "OFFICIAL", organizationId: "WHO" },
  "www.who.int": { sourceType: "OFFICIAL", trustTier: "OFFICIAL", organizationId: "WHO" },
  "nhc.gov.cn": { sourceType: "OFFICIAL", trustTier: "OFFICIAL", organizationId: "NHC-CN" },
  "www.nhc.gov.cn": { sourceType: "OFFICIAL", trustTier: "OFFICIAL", organizationId: "NHC-CN" },
  "samr.gov.cn": { sourceType: "OFFICIAL", trustTier: "OFFICIAL", organizationId: "SAMR-CN" },
  "www.samr.gov.cn": { sourceType: "OFFICIAL", trustTier: "OFFICIAL", organizationId: "SAMR-CN" },
  "nmpa.gov.cn": { sourceType: "OFFICIAL", trustTier: "OFFICIAL", organizationId: "NMPA-CN" },
  "www.nmpa.gov.cn": { sourceType: "OFFICIAL", trustTier: "OFFICIAL", organizationId: "NMPA-CN" },
  "reuters.com": { sourceType: "REPUTABLE", trustTier: "REPUTABLE", organizationId: "REUTERS" },
  "www.reuters.com": { sourceType: "REPUTABLE", trustTier: "REPUTABLE", organizationId: "REUTERS" },
  "apnews.com": { sourceType: "REPUTABLE", trustTier: "REPUTABLE", organizationId: "AP" },
  "www.apnews.com": { sourceType: "REPUTABLE", trustTier: "REPUTABLE", organizationId: "AP" },
  "nature.com": { sourceType: "REPUTABLE", trustTier: "REPUTABLE", organizationId: "NATURE" },
  "www.nature.com": { sourceType: "REPUTABLE", trustTier: "REPUTABLE", organizationId: "NATURE" },
  "science.org": { sourceType: "REPUTABLE", trustTier: "REPUTABLE", organizationId: "SCIENCE" },
  "www.science.org": { sourceType: "REPUTABLE", trustTier: "REPUTABLE", organizationId: "SCIENCE" },
};

export function classifySourceUrl(value: string): SourceClassification {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { sourceType: "EXTERNAL", trustTier: "UNRATED", organizationId: null, host: null };
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:") {
    return { sourceType: "EXTERNAL", trustTier: "UNRATED", organizationId: null, host };
  }
  const source = SOURCES[host];
  return source
    ? { ...source, host }
    : { sourceType: "EXTERNAL", trustTier: "UNRATED", organizationId: null, host };
}

export function allowedSourceHosts(): string[] {
  return Object.keys(SOURCES);
}
