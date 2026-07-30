import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
let proc: ReturnType<typeof Bun.spawn>; const port=43000+Math.floor(Math.random()*1000), base=`http://127.0.0.1:${port}`;
beforeAll(async()=>{ mkdirSync("dist/dashboard",{recursive:true}); writeFileSync("dist/dashboard/index.html","DASHBOARD_OK"); try{symlinkSync("/etc/passwd","dist/passwd-link")}catch{} proc=Bun.spawn({cmd:[process.execPath,"scripts/dashboard-adapter.ts"],env:{...process.env,TITEN_DASHBOARD_PORT:String(port)},stdout:"ignore",stderr:"pipe"}); for(let i=0;i<50;i++){try{if((await fetch(`${base}/dashboard`)).ok)return}catch{} await Bun.sleep(20)} throw new Error("adapter did not start")});
afterAll(()=>proc?.kill());
describe("dashboard adapter boundary",()=>{
 test("serves both dashboard routes",async()=>{for(const p of ["/dashboard","/dashboard/"])expect(await (await fetch(base+p)).text()).toBe("DASHBOARD_OK")});
 for(const p of ["//etc/passwd","/%2fetc/passwd","/%252fetc/passwd","/../etc/passwd","/%2e%2e/etc/passwd","/%252e%252e/etc/passwd","/..%5cetc%5cpasswd","/%255c..%255cetc/passwd","/etc/passwd%00","/passwd-link"]) test(`blocks ${p}`,async()=>{const r=await fetch(base+p); const b=await r.text(); expect(r.status).not.toBe(200); expect(b).not.toContain("root:x:")});
 test("rejects foreign host and origin",async()=>{expect((await fetch(base+"/dashboard-api/status",{headers:{host:"evil.test"}})).status).toBe(403); expect((await fetch(base+"/dashboard-api/status",{headers:{origin:"https://evil.test"}})).status).toBe(403)});
});
