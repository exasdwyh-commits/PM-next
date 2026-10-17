#!/usr/bin/env node
// 独立临时副本中的正反测试，不改生产数据。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'health-pack-test-'));
const pack=path.join(dir,'pack');
const run=()=>spawnSync(process.execPath,[path.join(root,'scripts/health-pack/validate-pack.mjs'),'--pack',pack,'--quiet'],{encoding:'utf8'});
let count=0;
try {
 fs.cpSync(path.join(root,'packs/health-food'),pack,{recursive:true});
 const f=path.join(pack,'data/claims.json');const original=fs.readFileSync(f,'utf8');
 assert.equal(run().status,0,'正常示例必须通过');count++;
 const bad=(change)=>{const d=JSON.parse(original);change(d.rows[0]);fs.writeFileSync(f,JSON.stringify(d));const r=run();assert.equal(r.status,1,r.stdout+r.stderr);assert.match(r.stdout,/R7/);count++;};
 bad(r=>{r.status='verified';r.verifiedAt='2026-10-17';});
 bad(r=>{r.allowed='allowed';});
 bad(r=>{r.evidenceUrl='https://example.com';r.evidenceGrade='L1';});
 bad(r=>{r.source='官方法规';});
 fs.writeFileSync(f,original);
 const cf=path.join(pack,'data/cases/low-sugar-high-protein.json');const c=JSON.parse(fs.readFileSync(cf,'utf8'));
 c.stages[0].gate='passed';c.stages[0].evidence=['cl-1'];c.stages[0].outputs=['demo'];fs.writeFileSync(cf,JSON.stringify(c));
 assert.equal(run().status,1,'模拟案例不得正式过门');count++;
 console.log(`health-pack regression: ${count}/${count} PASS`);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
