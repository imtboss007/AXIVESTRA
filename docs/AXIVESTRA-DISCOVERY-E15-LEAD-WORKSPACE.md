# AXIVESTRA E15 — Lead Review & Workspace Workflow

**Branch:** `feat/discovery-e11-explainable-matching`  
**Stage:** E11 match review → E15 lead inbox → assigned workspace pipeline  
**Authority:** company owner/admin only for match acceptance, assignment, priority, stage and next-action changes.

## Audit findings

E11 already stores deterministic workspace-fit scores, component rationales and a pending review state. However, there was no human match-review receipt, no conversion from an accepted match into a lead, and no durable lead assignment/stage history or lead pipeline UI. E15 adds those missing workflow layers without changing the E11 scoring algorithm.

## Match review

- Company members can view pending matches and their safe canonical-entity labels, score, confidence, eligibility and rationale factors.
- Only an owner/admin can accept a match for lead review or reject it.
- Ineligible matches cannot enter the lead pipeline.
- An accepted match creates exactly one lead in the `inbox` stage in the same transaction as the immutable match-review receipt.
- Rejected matches remain review receipts and do not create leads.
- The UI does not expose raw `candidate_snapshot` payloads or encrypted contact data.

## Lead pipeline

Each lead links to the original E11 match result, canonical company record and workspace key. It stores only workflow state: stage, priority, assignee, controlled next-action code and due date. It does not copy source contact values or personal contact details.

Stages:
`inbox → reviewing → qualified → due_diligence → proposal → negotiation → won/lost`

A lead may be placed `on_hold` or `disqualified` from permitted stages. Terminal stages can only be reopened to `reviewing` with an explicit `reopened` reason. Invalid stage jumps are rejected by the database.

Owners/admins can assign a lead only to a member of the same company, change priority, and set an internal next action/date. All changes append an immutable event and E13 provenance receipt. Company members have read access; write operations are service-role RPCs with an explicit company owner/admin membership check.

## UI and operational boundaries

The Discovery Sources screen now includes:
- pending E11 match review cards;
- a company lead inbox and pipeline filter;
- assignment, stage and priority controls;
- controlled internal next-action and due-date fields;
- recent immutable activity history.

No email, phone, WhatsApp, external outreach, underwriting, investment recommendation, credit approval or automated conversion is triggered. A lead stage is a workflow status only, not a financial or legal decision.

## Verification

The PostgreSQL integration test applies E15 after E14 and verifies:
- accepted eligible match creates one lead and immutable review receipt;
- duplicate review is rejected;
- ineligible match cannot be accepted and a rejected match creates no lead;
- cross-company/non-member assignees are rejected;
- valid assignment, stage transitions, priority and next action work;
- terminal lead reopening is explicit;
- E15 event history and E13 provenance remain append-only.

Contract tests verify the migration, edge actions, RLS and UI permission boundaries. No migration has been applied to a production database and no worker or external action has been activated.

## Visual refinement — 25 November 2026

The E15 workspace now separates lender and customer operations at the review surface without creating a second data model:

- All workspaces / Lender / Customer mode filters with selected-state and accessible pressed-state semantics.
- One search field across company identity, jurisdiction, entity type, workspace, stage and priority.
- Mode labels on pending matches and pipeline leads, with an explicit unclassified state where source mode is absent.
- Match-score meter alongside the numeric score and confidence.
- More legible review/pipeline hierarchy, priority emphasis, activity timeline treatment and responsive mobile filters.
- Subtle list/card/feedback entrance motion and interactive focus/hover states; all new motion is disabled under prefers-reduced-motion.

The UI remains workflow-only. These controls do not make a credit, lending, underwriting, investment or eligibility decision and do not initiate contact or outreach.

Regression coverage was added to services/discovery-engine/tests/lead-workspace-contract.test.mjs for mode filtering, search, score cues, motion hooks and reduced-motion support. Automated build and discovery-governance verification are running on the feature branch; physical Android inspection remains a separate acceptance gate.

## Follow-up accessibility and CI checkpoint — 25 November 2026

The search control wrapper is a neutral group rather than a label containing a second interactive control. The mode filters expose grouped pressed states, and the visible pending-match count uses a polite live announcement.

Verified against code head 82c4bd43c3507ec0ccf9d8b9acd0486a8685cb20:
- E15/discovery governance tests, worker/PostgreSQL integration, parser benchmark, full regression suite and web build: passed in push workflow 45676192783.
- Android APK and Windows installer build jobs: passed in workflow 45676192697.
- Cloud Worker and WhatsApp Hub checks: passed in pull-request workflows 45676200773 and 45676200831.
- Existing authenticated E18–E22 disposable-browser acceptance was still in progress at the last observation (Chromium setup). It does not exercise the E15 visual changes.

The E15 UI has not yet received a dedicated authenticated browser screenshot/interaction run or hands-on physical Android inspection. Keep those as explicit acceptance checks; do not equate the successful app build with visual acceptance on a device.
