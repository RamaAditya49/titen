#!/usr/bin/env bun
/** Real Bun/SQLite upstream + loopback adapter end-to-end verification. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteDb, openDatabase } from "../src/runtime/bun/sqlite";
import { serve } from "../src/runtime/bun/server";
import { provisionWith } from "../tests/contract/harness";
const dir=mkdtempSync(join(tmpdir(),"titen-live-")), dbPath=join(dir,"titen.db"), subject="subject-live", other="subject-other", marker="LIVE SUBJECT MARKER", leak="OTHER SUBJECT MUST NOT LEAK";
const api=await serve({dbPath,port:0,hostname:"127.0.0.1",quiet:true,revision:"verify"}); const {key}=await provisionWith(createSqliteDb(openDatabase(dbPath)),{scopes:["*"]});
async function call(path:string,body:unknown){const r=await fetch(api.url+path,{method:"POST",headers:{authorization:`Bearer ${key}`,"content-type":"application/json"},body:JSON.stringify(body)});const j:any=await r.json();assert.ok(r.ok,JSON.stringify(j));return j.data}
for(const [s,label] of [[subject,marker],[other,leak]]){const a=await call("/v1/observations",{subject_id:s,kind:"tool_result",content:"supports",source:{type:"tool",ref:s+"a"},trust:"verified"});const b=await call("/v1/observations",{subject_id:s,kind:"tool_result",content:"contradicts",source:{type:"tool",ref:s+"b"},trust:"verified"});await call("/v1/consolidations",{subject_id:s,claims:[{kind:"semantic_fact",statement:label,sources:[{observation_id:a.observation_id,relation:"supports"},{observation_id:b.observation_id,relation:"contradicts"}]}]})}
const port=44000+Math.floor(Math.random()*1000); const adapter=Bun.spawn({cmd:[process.execPath,"scripts/dashboard-adapter.ts"],env:{...process.env,TITEN_DASHBOARD_LIVE:"true",TITEN_API_URL:api.url,TITEN_API_KEY:key,TITEN_DASHBOARD_PORT:String(port)},stdout:"ignore",stderr:"pipe"});
try{let ready=false;for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/dashboard-api/status`)).ok){ready=true;break}}catch{}await Bun.sleep(20)}assert.ok(ready,"adapter starts");const r=await fetch(`http://127.0.0.1:${port}/dashboard-api/atlas/compile`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({lens:"conflict_freshness",subject_id:subject,limit:5})});const j:any=await r.json();assert.equal(r.status,200,JSON.stringify(j));const labels=j.data.nodes.map((n:any)=>n.label);assert.ok(labels.includes(marker));assert.ok(!labels.includes(leak));assert.equal(j.data.metadata.subject_id,subject);console.log("OK — real Bun/SQLite → scoped Atlas → loopback adapter E2E passed")}finally{adapter.kill();await api.stop();rmSync(dir,{recursive:true,force:true})}
