import test from "node:test";
import assert from "node:assert/strict";
import { evidenceObjectPath } from "./extraction-worker.mjs";

const companyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const jobId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const evidenceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const valid = "discovery-evidence:" + companyId + "/" + jobId + "/" + evidenceId + "-" + "a".repeat(64) + ".bin";

test("E05 evidence reader accepts only the private company/job/evidence content-addressed layout", () => {
  assert.equal(evidenceObjectPath(valid), valid.replace("discovery-evidence:",""));
});

test("E05 evidence reader rejects path traversal and malformed content hashes", () => {
  assert.throws(() => evidenceObjectPath("discovery-evidence:../../private.bin"), /expected company\/job\/evidence/);
  assert.throws(() => evidenceObjectPath("discovery-evidence:" + companyId + "/" + jobId + "/" + evidenceId + "-bad.bin"), /expected company\/job\/evidence/);
});
