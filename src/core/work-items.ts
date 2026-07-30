import { first } from "./db";
import { conflict, forbidden, notFound } from "./errors";
import { eventStatement } from "./events";
import { newId } from "./ids";
import type { RequestContext, Result } from "./http";
import { LIMITS, optionalString, requireInteger, requireObject, requireString } from "./validate";

type Role = "owner" | "admin" | "member" | "reader";
type Item = { id:string; workspace_id:string; kind:string; payload:string; priority:number; status:string; claimant_id:string|null; lease_version:number; lease_expires_at:string|null; attempts:number; outcome:string|null; created_at:string; updated_at:string; completed_at:string|null };

async function membership(ctx: RequestContext, workspaceId: string): Promise<Role> {
  const p = ctx.principal!;
  const row = await first<{role:Role}>(ctx.app.db,
    `SELECT m.role FROM memberships m JOIN workspaces w ON w.id=m.workspace_id AND w.org_id=m.org_id
     WHERE m.org_id=? AND m.workspace_id=? AND m.principal_id=? AND m.removed_at IS NULL`,
    [p.orgId, workspaceId, p.principalId]);
  if (!row) throw notFound();
  return row.role;
}

function publicItem(row: Item) {
  return { work_item_id:row.id, workspace_id:row.workspace_id, kind:row.kind,
    payload:JSON.parse(row.payload), priority:row.priority, status:row.status,
    claimant_id:row.claimant_id, lease_version:row.lease_version,
    lease_expires_at:row.lease_expires_at, attempts:row.attempts,
    outcome:row.outcome ? JSON.parse(row.outcome) : null, created_at:row.created_at,
    updated_at:row.updated_at, completed_at:row.completed_at };
}

async function item(ctx:RequestContext, id:string):Promise<Item> {
  const row=await first<Item>(ctx.app.db, `SELECT id,workspace_id,kind,payload,priority,status,claimant_id,lease_version,lease_expires_at,attempts,outcome,created_at,updated_at,completed_at FROM work_items WHERE id=? AND org_id=?`, [id,ctx.principal!.orgId]);
  if(!row) throw notFound();
  await membership(ctx,row.workspace_id);
  return row;
}

export async function createWorkItem(ctx:RequestContext):Promise<Result>{
  const b=requireObject(await ctx.json()); const workspaceId=requireString(b,"workspace_id",LIMITS.identifier);
  const role=await membership(ctx,workspaceId); if(role==="reader") throw forbidden();
  const kind=requireString(b,"kind",LIMITS.label); const payload=b.payload ?? {}; const priority=b.priority===undefined?0:requireInteger(b,"priority",-1000,1000);
  const id=newId("work"); const now=ctx.app.now().toISOString();
  await ctx.app.db.batch([{sql:`INSERT INTO work_items (id,org_id,workspace_id,kind,payload,priority,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,'pending',?,?,?)`,params:[id,ctx.principal!.orgId,workspaceId,kind,JSON.stringify(payload),priority,ctx.principal!.principalId,now,now]},eventStatement(ctx.principal!.orgId,"work_item.created",ctx.principal!.principalId,"work_item",id,{workspace_id:workspaceId,kind},now)]);
  return {status:201,data:{work_item_id:id,status:"pending"}};
}

export async function listWorkItems(ctx:RequestContext):Promise<Result>{
  const workspaceId=ctx.url.searchParams.get("workspace_id"); if(!workspaceId) throw conflict("workspace_id is required.");
  await membership(ctx,workspaceId); const status=ctx.url.searchParams.get("status");
  const rows=await ctx.app.db.all<Item>(`SELECT id,workspace_id,kind,payload,priority,status,claimant_id,lease_version,lease_expires_at,attempts,outcome,created_at,updated_at,completed_at FROM work_items WHERE org_id=? AND workspace_id=?${status?" AND status=?":""} ORDER BY priority DESC,created_at`,status?[ctx.principal!.orgId,workspaceId,status]:[ctx.principal!.orgId,workspaceId]);
  return {data:{work_items:rows.map(publicItem)}};
}

export async function claimWorkItem(ctx:RequestContext):Promise<Result>{
  const id=ctx.params.id!; const current=await item(ctx,id); const role=await membership(ctx,current.workspace_id); if(role==="reader") throw forbidden();
  const b=requireObject(await ctx.json()); const ttl=requireInteger(b,"ttl_seconds",10,86400); const token=newId("lease_token"); const now=ctx.app.now(); const nowIso=now.toISOString(); const expires=new Date(now.getTime()+ttl*1000).toISOString(); const p=ctx.principal!;
  await ctx.app.db.batch([{sql:`UPDATE work_items SET status='leased',claimant_id=?,lease_token=?,lease_version=lease_version+1,lease_expires_at=?,attempts=attempts+1,updated_at=? WHERE id=? AND org_id=? AND (status='pending' OR status='failed' OR (status='leased' AND lease_expires_at<=?))`,params:[p.principalId,token,expires,nowIso,id,p.orgId,nowIso]}]);
  const won=await first<Item & {lease_token:string}>(ctx.app.db,`SELECT id,workspace_id,kind,payload,priority,status,claimant_id,lease_token,lease_version,lease_expires_at,attempts,outcome,created_at,updated_at,completed_at FROM work_items WHERE id=? AND org_id=? AND claimant_id=? AND lease_token=?`,[id,p.orgId,p.principalId,token]);
  if(!won) throw conflict("Work item is not currently claimable.");
  await ctx.app.db.batch([eventStatement(p.orgId,"work_item.claimed",p.principalId,"work_item",id,{lease_version:won.lease_version,expires_at:expires},nowIso)]);
  return {data:{...publicItem(won),lease_token:token}};
}

function fenceBody(b:Record<string,unknown>){return {token:requireString(b,"lease_token",LIMITS.identifier),version:requireInteger(b,"lease_version",1,2147483647)}};

export async function heartbeatWorkItem(ctx:RequestContext):Promise<Result>{
  const current=await item(ctx,ctx.params.id!); const b=requireObject(await ctx.json()); const f=fenceBody(b); const ttl=requireInteger(b,"ttl_seconds",10,86400); const now=ctx.app.now(); const nowIso=now.toISOString(); const expires=new Date(now.getTime()+ttl*1000).toISOString(); const p=ctx.principal!;
  await ctx.app.db.batch([{sql:`UPDATE work_items SET lease_expires_at=?,updated_at=? WHERE id=? AND org_id=? AND status='leased' AND claimant_id=? AND lease_token=? AND lease_version=? AND lease_expires_at>?`,params:[expires,nowIso,current.id,p.orgId,p.principalId,f.token,f.version,nowIso]}]);
  const ok=await first<{id:string}>(ctx.app.db,`SELECT id FROM work_items WHERE id=? AND org_id=? AND claimant_id=? AND lease_token=? AND lease_version=? AND lease_expires_at=?`,[current.id,p.orgId,p.principalId,f.token,f.version,expires]); if(!ok) throw conflict("Lease fence is stale or expired.");
  await ctx.app.db.batch([eventStatement(p.orgId,"work_item.heartbeat",p.principalId,"work_item",current.id,{lease_version:f.version,expires_at:expires},nowIso)]); return {data:{work_item_id:current.id,lease_version:f.version,lease_expires_at:expires}};
}

export async function completeWorkItem(ctx:RequestContext):Promise<Result>{
  const current=await item(ctx,ctx.params.id!); const b=requireObject(await ctx.json()); const f=fenceBody(b); const key=requireString(b,"idempotency_key",LIMITS.identifier); const outcome=b.outcome??{}; const hash=JSON.stringify(outcome); const p=ctx.principal!;
  const prior=await first<{request_hash:string;response:string}>(ctx.app.db,`SELECT request_hash,response FROM work_item_completions WHERE work_item_id=? AND claimant_id=? AND idempotency_key=?`,[current.id,p.principalId,key]); if(prior){if(prior.request_hash!==hash) throw conflict("Idempotency key was used with a different outcome."); return {data:JSON.parse(prior.response)};}
  const now=ctx.app.now().toISOString(); const response={work_item_id:current.id,status:"completed",completed_at:now,lease_version:f.version};
  await ctx.app.db.batch([{sql:`UPDATE work_items SET status='completed',outcome=?,completed_at=?,updated_at=? WHERE id=? AND org_id=? AND status='leased' AND claimant_id=? AND lease_token=? AND lease_version=? AND lease_expires_at>?`,params:[hash,now,now,current.id,p.orgId,p.principalId,f.token,f.version,now]}]);
  const ok=await first<{id:string}>(ctx.app.db,`SELECT id FROM work_items WHERE id=? AND org_id=? AND status='completed' AND claimant_id=? AND lease_token=? AND lease_version=? AND completed_at=?`,[current.id,p.orgId,p.principalId,f.token,f.version,now]); if(!ok) throw conflict("Lease fence is stale or expired.");
  await ctx.app.db.batch([{sql:`INSERT INTO work_item_completions (work_item_id,claimant_id,idempotency_key,request_hash,response,created_at) VALUES (?,?,?,?,?,?)`,params:[current.id,p.principalId,key,hash,JSON.stringify(response),now]},eventStatement(p.orgId,"work_item.completed",p.principalId,"work_item",current.id,{lease_version:f.version},now)]); return {data:response};
}

export async function requeueWorkItem(ctx:RequestContext):Promise<Result>{
  const current=await item(ctx,ctx.params.id!); const role=await membership(ctx,current.workspace_id); const b=requireObject(await ctx.json()); const p=ctx.principal!; let fence:{token:string;version:number}|undefined;
  if(role!=="owner"&&role!=="admin") fence=fenceBody(b);
  const reason=optionalString(b,"reason",LIMITS.label); const now=ctx.app.now().toISOString(); const condition=fence?` AND status='leased' AND claimant_id=? AND lease_token=? AND lease_version=?`:` AND status IN ('leased','failed')`; const params:any[]=[now,current.id,p.orgId]; if(fence) params.push(p.principalId,fence.token,fence.version);
  await ctx.app.db.batch([{sql:`UPDATE work_items SET status='pending',claimant_id=NULL,lease_token=NULL,lease_expires_at=NULL,lease_version=lease_version+1,updated_at=? WHERE id=? AND org_id=?${condition}`,params}]); const updated=await first<{lease_version:number;updated_at:string}>(ctx.app.db,`SELECT lease_version,updated_at FROM work_items WHERE id=? AND org_id=? AND status='pending' AND updated_at=?`,[current.id,p.orgId,now]); if(!updated) throw conflict("Work item cannot be requeued with this fence.");
  await ctx.app.db.batch([eventStatement(p.orgId,"work_item.requeued",p.principalId,"work_item",current.id,{lease_version:updated.lease_version,reason:reason??null},now)]); return {data:{work_item_id:current.id,status:"pending",lease_version:updated.lease_version}};
}
