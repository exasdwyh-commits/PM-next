import { classifySourceUrl } from '../source-fetch/source-trust.mjs';

const LEVEL_ORDER={UNKNOWN:0,WEAK:1,SUPPORTED:2,STRONG:3,VERIFIED:4};

function normalizeText(value){
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
}

function supportFromText(claim,evidence){
  const source=normalizeText(evidence.rawContentPreview);
  const target=normalizeText(claim.claim);
  if(!source || !target || target.length < 12) {
    return {supportStatus:'NOT_FOUND',supportSpan:null};
  }
  const index=source.indexOf(target);
  if(index < 0) return {supportStatus:'NOT_FOUND',supportSpan:null};
  const start=Math.max(0,index-120);
  const end=Math.min(source.length,index+target.length+120);
  return {supportStatus:'SUPPORTED',supportSpan:source.slice(start,end)};
}

function independentlyAssessSource(claim,evidence){
  if(!evidence?.sourceUri) return null;
  const classification=classifySourceUrl(evidence.sourceUri);
  if(!['OFFICIAL','PRIMARY','REPUTABLE'].includes(classification.trustTier)) return null;
  if(!(evidence.httpStatus >= 200 && evidence.httpStatus < 300)) return null;
  if(evidence.injectionScanResult?.quarantined) return null;

  const support=supportFromText(claim,evidence);
  return {
    evidence,
    sourceType:classification.sourceType,
    trustTier:classification.trustTier,
    organizationId:classification.organizationId,
    host:classification.host,
    ...support
  };
}

export class EvidenceVerifier {
  constructor({identity='verifier-v2'}={}) {
    this.identity=identity;
  }

  verifyClaim({claim,modelEvidence=[],sourceEvidence=[]}) {
    const assessed=sourceEvidence
      .map(e=>independentlyAssessSource(claim,e))
      .filter(Boolean);
    const supported=assessed.filter(x=>x.supportStatus==='SUPPORTED');
    const strongish=supported.filter(x=>['OFFICIAL','PRIMARY'].includes(x.trustTier));
    const reputable=supported.filter(x=>x.trustTier==='REPUTABLE');
    const orgs=new Set(strongish.map(x=>x.organizationId).filter(Boolean));

    let evidenceLevel='UNKNOWN';
    if(strongish.length >= 2 && orgs.size >= 2) evidenceLevel='STRONG';
    else if(strongish.length >= 1) evidenceLevel='SUPPORTED';
    else if(reputable.length >= 1) evidenceLevel='WEAK';

    const allEvidenceIds=[
      ...modelEvidence.map(e=>e.id),
      ...assessed.map(x=>x.evidence.id)
    ].filter(Boolean);

    return {
      claim:claim.claim,
      claimKind:claim.claimKind ?? 'FACT',
      evidenceLevel,
      evidenceIds:allEvidenceIds,
      verification:{
        verifierIdentity:this.identity,
        verifiedAt:new Date().toISOString(),
        sourceCount:assessed.length,
        supportedSourceCount:supported.length,
        sourceOrganizations:[...new Set(assessed.map(x=>x.organizationId).filter(Boolean))],
        sources:assessed.map(x=>({
          evidenceId:x.evidence.id,
          sourceUri:x.evidence.sourceUri,
          host:x.host,
          organizationId:x.organizationId,
          trustTier:x.trustTier,
          supportStatus:x.supportStatus,
          supportSpan:x.supportSpan
        })),
        note:evidenceLevel==='UNKNOWN'
          ? 'No independently fetched trusted source contained a support span for this claim.'
          : 'Evidence level requires independently reclassified sources and a verifier-derived support span; rules-only verification never emits VERIFIED.'
      }
    };
  }

  verify({claims,modelEvidenceByClaim,sourceEvidenceByClaim}) {
    return claims.map((claim,index)=>this.verifyClaim({
      claim,
      modelEvidence:modelEvidenceByClaim[index] ?? [],
      sourceEvidence:sourceEvidenceByClaim[index] ?? []
    }));
  }
}

export function maxEvidenceLevel(levels){
  return [...levels].sort((a,b)=>(LEVEL_ORDER[b]??0)-(LEVEL_ORDER[a]??0))[0] ?? 'UNKNOWN';
}
