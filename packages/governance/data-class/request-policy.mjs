import { timingSafeEqual } from 'node:crypto';

const DATA_CLASS_RANK=Object.freeze({PUBLIC:0,INTERNAL:1,CONFIDENTIAL:2,RESTRICTED:3});

export function resolveDataClass(base='INTERNAL',requested=null){
  const baseRank=DATA_CLASS_RANK[base] ?? DATA_CLASS_RANK.INTERNAL;
  const requestedRank=requested==null ? baseRank : (DATA_CLASS_RANK[requested] ?? baseRank);
  const rank=Math.max(baseRank,requestedRank);
  return Object.keys(DATA_CLASS_RANK).find(k=>DATA_CLASS_RANK[k]===rank) ?? 'INTERNAL';
}

export function verifyBearerToken(expectedToken,authorizationHeader){
  if(!expectedToken) return true;
  const auth=authorizationHeader ?? '';
  if(!auth.startsWith('Bearer ')) return false;
  const supplied=Buffer.from(auth.slice(7));
  const expected=Buffer.from(expectedToken);
  return supplied.length===expected.length && timingSafeEqual(supplied,expected);
}
