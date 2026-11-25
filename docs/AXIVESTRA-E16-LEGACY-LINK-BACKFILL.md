# AXIVESTRA E16.1 — Legacy relationship backfill

The E16 migration originally added the normalized deal-party model without rewriting existing company records. E16.1 adds an owner/admin-controlled RPC to reconcile only explicit saved contact IDs into E16.

## What it reads

For active company-scoped `property` records, the backfill reads:
- `primaryContactId`
- `moduleData.__linkedContactIds`
- `moduleData.__contact_*` role fields

It joins each ID to an active `contact` record in the same company. It does not use contact names, phone numbers, email addresses, fuzzy matching, or follow-up-only IDs. Missing, deleted or cross-company contact records are ignored.

## Safety

- The migration only creates the RPC; it does not run it.
- `p_apply` defaults to `false` (dry run).
- Only company owners/admins may preview or apply it.
- The caller can cap the scan at 10,000 candidates.
- The preview returns stable record keys and role codes, not personal contact details.
- Applied links are always `unverified`; no evidence or identity is inferred.
- Existing links are not overwritten; the operation is idempotent.
- The source record payloads are never modified.

## Operator flow after approved deployment

1. Call `backfill_company_deal_parties_from_legacy_links(company_id, false, 5000)` as an owner/admin.
2. Review the candidate count and sample against known legacy records.
3. Confirm the mapping rules and the correct company.
4. Only with explicit owner/admin approval, call again with `p_apply=true`.
5. Review the E16/E17 graph and verify individual links using existing document metadata.

This is not a production deployment or a database migration execution. The function remains unavailable until the migration is separately reviewed and approved for deployment.
