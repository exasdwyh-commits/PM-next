const SUSPICIOUS_PATTERNS=[
  /ignore\s+(all\s+)?(previous|prior|system)\s+(instructions?|rules?)/i,
  /忽略.{0,12}(之前|上述|系统).{0,12}(指令|规则)/i,
  /system\s*prompt/i,
  /developer\s*message/i,
  /exfiltrat(e|ion)/i,
  /上传.{0,20}(公司|内部|机密|密钥|凭证)/i,
  /reveal.{0,20}(secret|credential|api\s*key)/i,
  /\b(upload|send|post|transmit|forward|email)\b.{0,40}\b(company|internal|secret|credential|api[_\s-]*key|token)/i,
  /\b(disregard|forget)\b.{0,30}\b(instructions?|directives?|guidelines?|rules?)\b/i,
  /\bact\s+as\b.{0,20}\b(unrestricted|dan|jailbreak|developer|system)\b/i,
  /\bsystem\s*:\s*.{0,40}\b(reveal|show|print|expose)\b/i,
  /\b(reveal|show|print|expose)\b.{0,20}\b(prompt|system|developer|secret|credential|api[_\s-]*key)\b/i,
  /越狱|忘掉.{0,12}(规则|指令|限制)|无视.{0,12}(规则|指令|限制)|把.{0,20}(内部资料|密钥|凭证).{0,20}(发|传|上传)/i,
  /(?:[A-Za-z0-9+\/]{120,}={0,2})/
];

function cleanText(value,max=4000){
  return String(value ?? '')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g,'')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'')
    .slice(0,max)
    .trim();
}

export function scanExternalText(text){
  const clean=cleanText(text);
  const flags=SUSPICIOUS_PATTERNS
    .map((pattern,index)=>pattern.test(clean)?`pattern-${index+1}`:null)
    .filter(Boolean);
  return {text:clean,flags,quarantined:flags.length>0};
}

function safeUrl(value){
  try{
    const u=new URL(String(value));
    return ['http:','https:'].includes(u.protocol)?u.toString():null;
  }catch{return null;}
}

export function sanitizeResearchPayload(payload={}){
  const securityFlags=[];
  const quarantinedItems=[];

  const summaryCheck=scanExternalText(payload.summary);
  if(summaryCheck.quarantined){
    securityFlags.push(...summaryCheck.flags.map(flag=>({field:'summary',flag})));
    quarantinedItems.push({field:'summary',reason:'instruction-like-content'});
  }

  const claims=[];
  for(const raw of Array.isArray(payload.claims)?payload.claims:[]){
    const c=scanExternalText(raw?.claim);
    const area=cleanText(raw?.area ?? 'general',80) || 'general';
    const sourceUrls=(Array.isArray(raw?.sourceUrls)?raw.sourceUrls:[])
      .map(safeUrl).filter(Boolean).slice(0,10);
    if(c.quarantined){
      securityFlags.push(...c.flags.map(flag=>({field:'claim',area,flag})));
      quarantinedItems.push({field:'claim',area,reason:'instruction-like-content'});
    }
    claims.push({claim:c.text,area,sourceUrls,quarantined:c.quarantined,securityFlags:c.flags});
  }

  const unknowns=[];
  for(const raw of Array.isArray(payload.unknowns)?payload.unknowns:[]){
    const u=scanExternalText(raw);
    if(u.quarantined){
      securityFlags.push(...u.flags.map(flag=>({field:'unknown',flag})));
      quarantinedItems.push({field:'unknown',reason:'instruction-like-content'});
      continue;
    }
    if(u.text && !unknowns.includes(u.text)) unknowns.push(u.text);
    if(unknowns.length>=30) break;
  }

  const suggestedNextActions=[];
  for(const raw of Array.isArray(payload.suggestedNextActions)?payload.suggestedNextActions:[]){
    const a=scanExternalText(raw);
    if(a.quarantined){
      securityFlags.push(...a.flags.map(flag=>({field:'nextAction',flag})));
      quarantinedItems.push({field:'nextAction',reason:'instruction-like-content'});
      continue;
    }
    if(a.text && !suggestedNextActions.includes(a.text)) suggestedNextActions.push(a.text);
    if(suggestedNextActions.length>=20) break;
  }

  return {
    summary:summaryCheck.quarantined ? 'Research output contained quarantined instruction-like content.' : summaryCheck.text,
    claims,
    unknowns,
    suggestedNextActions,
    securityFlags,
    quarantinedItems
  };
}
