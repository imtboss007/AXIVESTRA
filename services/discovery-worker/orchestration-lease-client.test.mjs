import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createOrchestrationLeaseClient,
  hashWorkerCredential
} from "./orchestration-lease-client.mjs";

const hash=value=>createHash("sha256").update(value,"utf8").digest("hex");
const workerToken="temporary-worker-credential-that-never-enters-audit-history";

test("E20.4 hashes worker credentials and keeps lease token only in process memory",async()=>{
  const calls=[];
  const leaseTokenHashExpected=[];
  const admin={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==="claim_discovery_orchestration_lease"){
      leaseTokenHashExpected.push(args.p_lease_token_hash);
      return {data:[{
        lease_id:"lease-001",execution_id:"execution-001",run_id:"run-001",
        step_id:"step-001",stage_key:"e05_extraction",adapter_key:"e05-test-v1",
        worker_identity:"test-worker",leased_at:"2026-11-23T12:00:00Z",
        expires_at:"2026-11-23T12:02:00Z"
      }],error:null};
    }
    if(name==="heartbeat_discovery_orchestration_lease")return {data:true,error:null};
    if(name==="release_discovery_orchestration_lease")return {data:true,error:null};
    return {data:null,error:null};
  }};
  const client=createOrchestrationLeaseClient({
    admin,companyId:"company-001",workerIdentityId:"worker-id-001",workerToken
  });
  const lease=await client.claim({leaseSeconds:90});
  assert.equal(lease.lease_id,"lease-001");
  assert.equal(client.activeLeaseCount(),1);
  assert.equal(calls[0].args.p_worker_credential_hash,hash(workerToken));
  assert.equal(calls[0].args.p_lease_seconds,90);
  assert.equal(leaseTokenHashExpected[0].length,64);
  assert.notEqual(lease.leaseToken,leaseTokenHashExpected[0]);
  assert.equal(await client.heartbeat(lease.lease_id,{leaseSeconds:60}),true);
  assert.equal(calls[1].args.p_lease_token_hash,hash(lease.leaseToken));
  assert.equal(await client.release(lease.lease_id,"Worker finished its lease handoff safely."),true);
  assert.equal(calls[2].args.p_lease_token_hash,hash(lease.leaseToken));
  assert.equal(client.activeLeaseCount(),0);
});

test("E20.4 returns no work when the server-side dispatch gate returns an empty claim",async()=>{
  const client=createOrchestrationLeaseClient({
    admin:{rpc:async()=>({data:[],error:null})},
    companyId:"company-001",workerIdentityId:"worker-id-001",workerToken
  });
  assert.equal(await client.claim(),null);
  assert.equal(client.activeLeaseCount(),0);
});

test("E20.4 fails closed on RPC errors and rejects missing credentials",async()=>{
  assert.throws(()=>hashWorkerCredential("short"),/missing or invalid/);
  assert.throws(()=>createOrchestrationLeaseClient({
    admin:null,
    companyId:"company-001",workerIdentityId:"worker-id-001",workerToken
  }),/server-side Supabase service client is required/);
  const deniedClient=createOrchestrationLeaseClient({
    admin:{rpc:async()=>({data:null,error:{message:"permission denied"}})},
    companyId:"company-001",workerIdentityId:"worker-id-001",workerToken
  });
  await assert.rejects(deniedClient.claim(),/failed closed: permission denied/);
  const client=createOrchestrationLeaseClient({
    admin:{rpc:async()=>({data:null,error:{message:"worker grant expired"}})},
    companyId:"company-001",workerIdentityId:"worker-id-001",workerToken
  });
  await assert.rejects(client.claim(),/failed closed: worker grant expired/);
});

test("E20.4 cannot renew or release a lease after the client has forgotten its token",async()=>{
  const names=[];
  const client=createOrchestrationLeaseClient({
    admin:{rpc:async(name)=>{names.push(name);return {data:true,error:null};}},
    companyId:"company-001",workerIdentityId:"worker-id-001",workerToken
  });
  client.forgetLease("unknown-lease");
  assert.equal(await client.heartbeat("unknown-lease"),false);
  assert.equal(await client.release("unknown-lease","No in-memory token remains for this lease."),false);
  assert.deepEqual(names,[]);
});
