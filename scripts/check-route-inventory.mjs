import { readFileSync } from "node:fs";
const app=readFileSync(new URL("../src/core/app.ts",import.meta.url),"utf8");
const api=readFileSync(new URL("../docs/reference/api.md",import.meta.url),"utf8");
const required=[
  "POST /v1/work-items","GET /v1/work-items","POST /v1/work-items/:id/claim",
  "POST /v1/work-items/:id/heartbeat","POST /v1/work-items/:id/complete","POST /v1/work-items/:id/requeue",
];
const missing=required.filter(route=>{const [method,path]=route.split(" "); return !app.includes(`method: "${method}", path: "${path}"`)||!api.includes(path)});
if(missing.length){console.error(`Operator queue route inventory missing: ${missing.join(", ")}`);process.exit(1)}
console.log(`Operator queue route inventory covers ${required.length} routes.`);
