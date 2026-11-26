import test from "node:test";
import assert from "node:assert/strict";
import { evidenceObjectPath, runRetentionSweepOnce } from "./retention-sweeper.mjs";

const valid = {
  company_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  job_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  source_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  raw_blob_ref: "discovery-evidence:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/dddddddd-dddd-4ddd-8ddd-dddddddddddd-" + "a".repeat(64) + ".bin",
  canonical_url: "https://registry.example.gov.in/api/v1/entities/1",
  captured_at: "2026-01-01T00:00:00Z",
  retention_days: 30,
  content_hash: "a".repeat(64)
};

function makeAdmin(expired, { storageError = null, receiptError = null, deleteError = null } = {}) {
  const operations = [];
  return {
    operations,
    rpc: async (name, args) => {
      operations.push({ kind: "rpc", name, args });
      return { data: expired, error: null };
    },
    storage: {
      from: bucket => ({
        remove: async paths => {
          operations.push({ kind: "storage-remove", bucket, paths });
          return { error: storageError };
        }
      })
    },
    from: table => ({
      insert: async row => {
        operations.push({ kind: "insert", table, row });
        return { error: receiptError };
      },
      delete: () => {
        const builder = {
          filters: {},
          eq(key, value) { this.filters[key] = value; return this; },
          select() { return this; },
          maybeSingle: async () => {
            operations.push({ kind: "delete", table, filters: { ...builder.filters } });
            return { data: deleteError ? null : { id: valid.id }, error: deleteError };
          },
          then(resolve, reject) {
            return this.maybeSingle().then(resolve, reject);
          }
        };
        return builder;
      }
    })
  };
}

test("content-addressed evidence path requires company, job and object UUIDs", () => {
  assert.equal(evidenceObjectPath(valid.raw_blob_ref),
    valid.raw_blob_ref.replace("discovery-evidence:",""));
  assert.throws(() => evidenceObjectPath("discovery-evidence:../../private.bin"), /company\/job\/object/);
});

test("retention sweep deletes private blob, appends purge receipt and deletes metadata", async () => {
  const admin = makeAdmin([valid]);
  const result = await runRetentionSweepOnce(admin);
  assert.deepEqual({ examined: result.examined, removed: result.removed, failed: result.failed }, {
    examined: 1, removed: 1, failed: 0
  });
  assert.deepEqual(admin.operations.map(item => item.kind), ["rpc","storage-remove","insert","delete"]);
  assert.equal(admin.operations[1].bucket,"discovery-evidence");
  assert.equal(admin.operations[2].row.event_type,"retention_purged");
  assert.equal(admin.operations[2].row.evidence_id,valid.id);
  assert.deepEqual(admin.operations[3].filters,{company_id:valid.company_id,id:valid.id});
});

test("retention does not delete evidence metadata if private blob deletion fails", async () => {
  const admin = makeAdmin([valid], {storageError:{message:"storage unavailable"}});
  const result = await runRetentionSweepOnce(admin);
  assert.equal(result.removed,0);
  assert.equal(result.failed,1);
  assert.equal(admin.operations.some(item=>item.kind==="insert"),false);
  assert.equal(admin.operations.some(item=>item.kind==="delete"),false);
});

test("duplicate purge receipts are idempotent and allow metadata deletion to finish", async () => {
  const admin = makeAdmin([valid], {receiptError:{code:"23505",message:"duplicate receipt"}});
  const result = await runRetentionSweepOnce(admin);
  assert.equal(result.removed,1);
  assert.equal(result.failed,0);
  assert.ok(admin.operations.some(item=>item.kind==="delete"));
});

test("retention batch size is bounded", async () => {
  const admin = makeAdmin([]);
  await assert.rejects(runRetentionSweepOnce(admin,0),/between 1 and 100/);
  await assert.rejects(runRetentionSweepOnce(admin,101),/between 1 and 100/);
});
