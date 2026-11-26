# AXIVESTRA E18 — Commitments & Operational Action Workspace

**Stage:** Gate 6 operational commitments foundation  
**Migration:** 20261122330000_axivestra_commitment_workspace.sql  
**Depends on:** E16 deal-party links and E17 relationship graph

## Delivered

E18 adds a structured company-scoped register for four types of operational records: task, promise, obligation and milestone. Each record has a title, editable summary, status, priority, controlled next-action code, due date, responsible company member and optional links to a deal, party, matching E16 relationship and legacy task record. The workspace supports editing title, summary, next action and matching relationship with immutable detail-change history.

- Deal and party links use company-scoped stable record keys.
- A supplied relationship ID must be the E16 edge connecting the same deal and party.
- A responsible person must be a member of the same company.
- Staff may assign actions only to themselves and may update actions assigned to them or created by them; owner/admin/manager roles can manage broader assignments.
- New actions start in open. Status transitions are constrained. Completed items can only be reopened to in_progress with the explicit reopened reason; cancelled items are terminal.
- Every create/status/assignee/due-date/details change generates an append-only event with actor and previous/new state.
- Hard deletion is blocked. Active commitments also prevent soft deletion of their linked deal, party or source task. Completion and cancellation preserve history.
- company_commitment_inbox derives overdue, due_today, upcoming, no_due_date and closed states from due timestamps and status; no background scheduler is claimed.

## Relationship to existing tasks

Existing local task collections and their device-sync behaviour remain unchanged. E18 is an additive cloud structured-commitment register. A legacy task can be linked by a stable source_task_record_key. The E18 workspace now exposes an explicit per-task reconciliation/import action for company-cloud task records. It copies the task title, notes, due date, priority and next-action code into a structured commitment and retains the original task unchanged. Completed source tasks are explicitly transitioned to completed after creation. Already-linked records are filtered from the candidate list and the database uniqueness constraint prevents duplicate source-task links. Device-local tasks not yet synced into the company cloud register are counted and identified as needing sync before linking. No automatic copy, migration or deletion takes place.

## Security and data boundaries

Company membership is enforced in RLS and in the database write guard. Composite foreign keys block cross-company deal, party, relationship and source-task links. The table is readable by company members and writable only by operational roles; event history is immutable. E18 does not send messages, create reminders, schedule recurring work or perform external outreach.

## Verification

The PostgreSQL integration test verifies commitment creation, overdue projection, status completion, company scoping, relationship consistency, source-task integrity and immutable event history. Contract tests also verify that the UI exposes summary/detail editing, matching relationship selection, and explicit legacy-task linking without changing the source task.

A dedicated Playwright spec now covers authenticated E18 commitment creation, summary editing, E16 relationship selection and one-time legacy-task linking. It is fixture-gated and has not been run against a live company account in this work session because no E18 QA credentials/company fixture are configured in the current Actions environment. The spec expects:
- Build-time: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or `VITE_SUPABASE_ANON_KEY`)
- Test-time: `AXIVESTRA_E2E_EMAIL`, `AXIVESTRA_E2E_PASSWORD`, `AXIVESTRA_E2E_COMPANY_NAME`, `AXIVESTRA_E2E_DEAL_TITLE`, and `AXIVESTRA_E2E_PARTY_NAME`
- Optional: `AXIVESTRA_E2E_RELATIONSHIP_LABEL` to select a particular active E16 edge and `AXIVESTRA_E2E_LEGACY_TASK_TITLE` to exercise one unlinked cloud-synced task

Build with the Vite variables, then run `npm run test:e2e -- tests/browser/axivestra-commitment-workspace.spec.ts` with the test variables. Use a dedicated QA company: the first test creates and cancels a commitment (history is retained), and the legacy-task test consumes the selected source-task link once. The original task itself remains unchanged. Do not put credentials or keys in source control.
