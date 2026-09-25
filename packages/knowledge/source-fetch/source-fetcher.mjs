import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { classifySourceUrl } from './source-trust.mjs';
import { scanExternalText } from './untrusted-content.mjs';

const ACCEPTED_MIME=new Set(['text/html','text/plain','application/json','application/xhtml+xml']);
const blocked=new BlockList();
for (const [network,prefix] of [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],
  ['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],
  ['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]
]) blocked.addSubnet(network,prefix,'ipv4');
blocked.addAddress('::','ipv6');
blocked.addAddress('::1','ipv6');
for (const [network,prefix] of [
  ['fc00::',7],['fe80::',10],['ff00::',8],['2001:db8::',32]
]) blocked.addSubnet(network,prefix,'ipv6');

function normalizedIp(address){
  if(String(address).startsWith('::ffff:') && isIP(String(address).slice(7))===4) {
    return String(address).slice(7);
  }
  return String(address);
}

export function isPublicAddress(address){
  const normalized=normalizedIp(address);
  const family=isIP(normalized);
  if(!family) return false;
  return !blocked.check(normalized,family===4?'ipv4':'ipv6');
}

function assertAllowedUrl(url){
  const classified=classifySourceUrl(url);
  if(!classified.host) throw new Error('invalid-source-url');
  if(!['OFFICIAL','PRIMARY','REPUTABLE'].includes(classified.trustTier)){
    throw new Error('source-domain-not-allowlisted');
  }
  return classified;
}

async function defaultResolver(host){
  return dnsLookup(host,{all:true,verbatim:true});
}

async function resolvePinned(host,resolver){
  const records=await resolver(host);
  if(!Array.isArray(records) || records.length===0) throw new Error('source-dns-empty');
  const normalized=records.map(r=>({
    address:normalizedIp(r.address),
    family:r.family ?? isIP(normalizedIp(r.address))
  }));
  if(normalized.some(r=>!isPublicAddress(r.address))) throw new Error('source-address-not-public');
  return normalized;
}

function headerValue(headers,name){
  if(!headers) return null;
  if(typeof headers.get==='function') return headers.get(name);
  const value=headers[String(name).toLowerCase()] ?? headers[name];
  return Array.isArray(value) ? value[0] : (value ?? null);
}

async function defaultRequest({url,pinned,maxBytes,timeoutMs}){
  const target=new URL(url);
  const pin=pinned[0];
  return new Promise((resolve,reject)=>{
    const req=https.request(target,{
      method:'GET',
      headers:{
        'user-agent':'PM-OS-EvidenceFetcher/0.2',
        'accept':'text/html,text/plain,application/json,application/xhtml+xml;q=0.9',
        'accept-encoding':'identity'
      },
      servername:target.hostname,
      lookup:(hostname,options,callback)=>{
        if(options?.all) return callback(null,pinned);
        callback(null,pin.address,pin.family);
      }
    },res=>{
      const remote=normalizedIp(res.socket?.remoteAddress ?? '');
      if(!isPublicAddress(remote) || !pinned.some(x=>x.address===remote)){
        res.destroy();
        reject(new Error('source-remote-address-mismatch'));
        return;
      }

      const headers=res.headers;
      const encoding=String(headerValue(headers,'content-encoding') ?? 'identity').toLowerCase();
      if(encoding && encoding !== 'identity'){
        res.resume();
        reject(new Error('source-compressed-content-rejected'));
        return;
      }

      const declared=Number(headerValue(headers,'content-length') ?? 0);
      if(declared && declared > maxBytes){
        res.resume();
        reject(new Error('source-too-large'));
        return;
      }

      const status=res.statusCode ?? 0;
      if(status>=300 && status<400){
        res.resume();
        resolve({status,headers,body:'',remoteAddress:remote});
        return;
      }

      const contentType=String(headerValue(headers,'content-type') ?? '').split(';')[0].trim().toLowerCase();
      if(!ACCEPTED_MIME.has(contentType)){
        res.resume();
        reject(new Error('source-content-type-not-allowed'));
        return;
      }

      const chunks=[];
      let total=0;
      res.on('data',chunk=>{
        total+=chunk.length;
        if(total>maxBytes){
          req.destroy(new Error('source-too-large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end',()=>resolve({
        status,headers,body:Buffer.concat(chunks).toString('utf8'),remoteAddress:remote
      }));
    });
    req.setTimeout(timeoutMs,()=>req.destroy(new Error('source-timeout')));
    req.on('error',reject);
    req.end();
  });
}

export async function fetchSource({
  url,
  resolver=defaultResolver,
  requestImpl=defaultRequest,
  timeoutMs=6000,
  maxBytes=131072,
  maxRedirects=3
}){
  let currentUrl=url;
  let redirects=0;

  while(true){
    const classified=assertAllowedUrl(currentUrl);
    const pinned=await resolvePinned(classified.host,resolver);
    const response=await requestImpl({
      url:currentUrl,
      pinned,
      timeoutMs,
      maxBytes
    });

    const remote=normalizedIp(response.remoteAddress ?? '');
    if(!isPublicAddress(remote) || !pinned.some(x=>x.address===remote)){
      throw new Error('source-remote-address-mismatch');
    }

    if(response.status>=300 && response.status<400){
      const location=headerValue(response.headers,'location');
      if(!location) throw new Error('redirect-without-location');
      if(redirects>=maxRedirects) throw new Error('too-many-redirects');
      currentUrl=new URL(location,currentUrl).toString();
      assertAllowedUrl(currentUrl);
      redirects++;
      continue;
    }

    if(!(response.status>=200 && response.status<300)) throw new Error('source-http-status-not-success');

    const encoding=String(headerValue(response.headers,'content-encoding') ?? 'identity').toLowerCase();
    if(encoding && encoding !== 'identity') throw new Error('source-compressed-content-rejected');

    const contentType=String(headerValue(response.headers,'content-type') ?? '').split(';')[0].trim().toLowerCase();
    if(!ACCEPTED_MIME.has(contentType)) throw new Error('source-content-type-not-allowed');

    const declared=Number(headerValue(response.headers,'content-length') ?? 0);
    if(declared && declared > maxBytes) throw new Error('source-too-large');

    const raw=String(response.body ?? '');
    if(Buffer.byteLength(raw,'utf8') > maxBytes) throw new Error('source-too-large');
    if(!raw.trim()) throw new Error('source-empty-content');

    const scan=scanExternalText(raw);
    const finalClass=assertAllowedUrl(currentUrl);
    return {
      url:currentUrl,
      requestedUrl:url,
      redirectCount:redirects,
      httpStatus:response.status,
      ok:true,
      fetchedAt:new Date().toISOString(),
      contentHash:createHash('sha256').update(raw,'utf8').digest('hex'),
      rawContentPreview:scan.text.slice(0,12000),
      injectionScanResult:{quarantined:scan.quarantined,flags:scan.flags},
      sourceType:finalClass.sourceType,
      trustTier:scan.quarantined ? 'QUARANTINED' : finalClass.trustTier,
      organizationId:finalClass.organizationId,
      host:finalClass.host,
      remoteAddress:remote,
      contentType
    };
  }
}
