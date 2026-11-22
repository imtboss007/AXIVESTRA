# AXIVESTRA E18 — Commitments & Operational Action Workspace

**Stage:** Gate 6 operational commitments foundation  
**Migration:** 20261122330000_axivestra_commitment_workspace.sql  
**Depends on:** E16 deal-party links and E17 relationship graph

## Delivered

E18 adds a structured company-scoped register for four types of operational records: task, promise, obligation and milestone. Each record has a title, summary, status, priority, controlled next-action code, due date, responsible company member and optional links to a deal, party, E16 relationship and legacy task record.

- Deal and party links use company-scoped stable record keys.
- A supplied relationship ID must be the E16 edge connecting the same deal and party.
- A responsible person must be a member of the same company.
- Staff may assign actions only to themselves and may update actions assigned to them or created by them; owner/admin/manager roles can manage broader assignments.
- New actions start in open. Status transitions are constrained. Completed items can only be reopened to in_progress with the explicit reopened reason; cancelled items are terminal.
- Every create/status/assignee/due-date/details change generates an append-only event with actor and previous/new state.
- Hard deletion is blocked. Completion and cancellation preserve history.
- company_commitment_inbox derives overdue, due_today, upcoming, no_due_date and closed states from due timestamps and status; no background scheduler is claimed.

## Relationship to existing tasks

Existing local task collections and their device-sync behaviour remain unchanged. E18 is an additive cloud structured-commitment register. A legacy task can be linked by a stable source_task_record_key, but E18 does not automatically copy, migrate or delete legacy tasks. Explicit reconciliation/import and a UI workflow are separate acceptance steps.

## Security and data boundaries

Company membership is enforced in RLS and in the database write guard. Composite foreign keys block cross-company deal, party, relationship and source-task links. The table is readable by company members and writable only by operational roles; event history is immutable. E18 does not send messages, create reminders, schedule recurring work or perform external outreach.

## Verification

The PostgreSQL integration test verifies commitment creation, overdue projection, status completion, company scoping, relationship consistency and immutable event history. Contract tests cover role gates, lifecycle constraints, derived due states and the additive boundary.
