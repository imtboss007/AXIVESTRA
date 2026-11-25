import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const handler = await readFile(new URL("../../../supabase/functions/discovery-control/index.ts", import.meta.url), "utf8");

test("enqueue requires company-scoped profile, source and profile-source attachment", () => {
  assert.match(handler, /action === "jobs\.enqueue"/);
  assert.match(handler, /\.eq\("company_id", companyId\).*\.eq\("id", payload\.profileId\)/s);
  assert.match(handler, /\.eq\("profile_id", payload\.profileId\).*\.eq\("source_id", payload\.sourceId\)/s);
});

test("enqueue requires enabled profile, approved source and matching allow-listed purpose", () => {
  assert.match(handler, /profile\.enabled !== true/);
  assert.match(handler, /source\.status !== "approved"/);
  assert.match(handler, /purpose !== profile\.purpose/);
  assert.match(handler, /source\.allowed_purposes/);
});

test("enqueue bounds criteria size and requires idempotency key", () => {
  assert.match(handler, /idempotencyKey\.length < 8 \|\| idempotencyKey\.length > 160/);
  assert.match(handler, /encode\(JSON\.stringify\(criteria\)\)\.length > 8192/);
  assert.match(handler, /unique|23505/);
});

test("enqueue ignores browser-supplied criteria and snapshots the company profile criteria", () => {
  const enqueue = handler.slice(handler.indexOf('if (action === "jobs.enqueue")'), handler.indexOf('if (action === "matches.candidates.list")'));
  assert.match(enqueue, /const criteria = profile\.criteria/);
  assert.match(enqueue, /p_payload:\s*\{\s*purpose,\s*criteria,\s*candidateUrls\s*\}/);
  assert.doesNotMatch(enqueue, /payload\.criteria/);
  assert.match(enqueue, /company-scoped database profile is the sole authority/);
  assert.match(enqueue, /saved workspace criteria must not exceed 8 KB/);
});

test("queue history is company scoped and bounded", () => {
  assert.match(handler, /action === "jobs\.list"/);
  assert.match(handler, /\.eq\("company_id", companyId\).*\.limit\(100\)/s);
});

test("enqueue explicitly does not perform source network access", () => {
  assert.match(handler, /Enqueue does not contact the source/);
});
