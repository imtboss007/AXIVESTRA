import test from "node:test";
import assert from "node:assert/strict";
import { OFFICIAL_SOURCE_STARTERS, toSourceDraft } from "../../../src/lib/discovery-source-catalogue.mjs";

test("official source starters are limited to identified RBI, NHB and MCA public entry points", () => {
  assert.deepEqual(OFFICIAL_SOURCE_STARTERS.map(source => source.id), [
    "rbi-bank-links", "rbi-nbfc-register", "nhb-hfc-register", "mca-company-master"
  ]);
  for (const source of OFFICIAL_SOURCE_STARTERS) {
    assert.match(source.canonicalUrl, /^https:\/\//);
    assert.ok(["www.rbi.org.in", "www.nhb.org.in", "www.mcacdm.nic.in"].includes(source.domain));
    assert.ok(source.allowedPaths.length > 0);
    assert.ok(source.allowedPurposes.length > 0);
    assert.ok(source.allowedFields.length > 0);
  }
});

test("starter sources remain pending and require an administrator to complete terms review", () => {
  for (const source of OFFICIAL_SOURCE_STARTERS) {
    const draft = toSourceDraft(source);
    assert.equal(draft.termsUrl, "");
    assert.match(draft.licenseRef, /Pending/);
    assert.match(draft.policyNotes, /review/i);
    assert.deepEqual(draft.allowedPaths.split("\n"), source.allowedPaths);
  }
});

test("RBI/NHB sources are lenders and MCA is company identity research, not contact scraping", () => {
  assert.ok(OFFICIAL_SOURCE_STARTERS.filter(x => x.category === "LENDER").length === 3);
  const mca = OFFICIAL_SOURCE_STARTERS.find(x => x.id === "mca-company-master");
  assert.equal(mca.category, "CUSTOMER");
  assert.ok(!mca.allowedFields.some(field => /phone|email|mobile/i.test(field)));
  assert.match(mca.policyNotes, /Do not bypass forms, authentication or access controls/);
});

test("source draft helper rejects arbitrary or substituted sources", () => {
  assert.throws(() => toSourceDraft({ id: "lookalike", canonicalUrl: "https://example.com" }), /known AXIVESTRA/);
});
