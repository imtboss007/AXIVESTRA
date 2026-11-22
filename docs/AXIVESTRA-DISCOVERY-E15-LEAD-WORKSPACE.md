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
