# AXIVESTRA — Paired Android / Windows Device Acceptance Protocol

**Status:** Test procedure prepared; physical paired-device acceptance is still PENDING.
**Purpose:** Complete R4 using disposable non-production data only.
**Repository:** imtboss007/AXIVESTRA.
**Current integration branch:** feat/discovery-e10-enrichment.
**Reference product-code commit:** c2c8fb173e2e80c3eface6c574a616c8b498227b.

## 1. What this protocol does and does not cover

The current device reconciliation module declares eight collections: properties, contacts, whatsappGroups, tasks, financials, riskRecords, approvalRequests and auditEvents. It stores per-record updated/deleted metadata and uses deletion tombstones so a stale copy cannot silently resurrect a deleted record.

This protocol tests the existing local/device snapshot sync only. Cloud-native discovery, E16 deal-party relationship rows, E17 graph projections and E18–E22 cloud workflows are not included in the eight-collection snapshot contract. Do not infer that these cloud features sync locally because the device test passes.

The deterministic function test at scripts/device-sync.test.cjs covers initial PC-to-phone snapshot, an Android-side edit reaching the PC, a deletion marker and rejection of a stale PC copy. Physical transport, authentication, installation, account isolation and real app lifecycle remain unverified until exercised on devices.

## 2. Required test setup

- One physical Android phone and one physical Windows PC.
- AXIVESTRA Android APK and Windows installer built from the same integration source commit. Record the exact commit and artifact SHA-256 for each.
- A dedicated non-production test account and company accessible on both devices. Never use production customer, lender, tenant, investor or legal-case data.
- A small synthetic data set with unique QA labels. Record the IDs of the test records so the reviewer can distinguish them from existing data.
- Stable network access for baseline tests. A separate optional pass can test interrupted connectivity and retry/resume.
- Screenshots/logs must be redacted. Never capture passwords, API keys, access tokens or real contact details.

## 3. Mandatory test cases

| ID | Action | Expected result | Status |
|---|---|---|---|
| DEV-01 | Sign into the same non-production company on both devices and perform the normal sync. Create a synthetic property and contact on Windows first. | Both records appear on Android with matching stable IDs and field values; unrelated records remain unchanged. | PENDING |
| DEV-02 | Edit a non-sensitive field on the Android test property, sync, then inspect Windows. | The Android edit is present on Windows and survives app refresh. | PENDING |
| DEV-03 | Edit a different test record on Windows, sync, then inspect Android. | The Windows edit is present on Android and survives app refresh. | PENDING |
| DEV-04 | On Android, delete only the disposable test property through the supported UI, sync, then refresh Windows. | The record stays deleted on both devices; a stale Windows snapshot does not restore it. | PENDING |
| DEV-05 | Reopen each app and repeat sync after the previous updates/deletion. | Updates remain stable, deleted record remains absent and no duplicate record appears. | PENDING |
| DEV-06 | Temporarily interrupt network access during a test edit, restore connectivity and use the normal sync action. | The app recovers without losing unrelated data or creating duplicates. Record any retry delay or manual recovery needed. | PENDING / BLOCKED if offline editing is not supported by the current app flow |
| DEV-07 | If two separate disposable companies are available, sign out of one and into the other on each device. | No record from the first company is visible in the second company session. | PENDING |
| DEV-08 | Edit the same disposable record independently on both devices before syncing either change. | Record the winning value and timestamps. Confirm behaviour is deterministic and consistent with the documented timestamp-based reconciliation; record that the current function does not present a user-facing merge-conflict resolver. | PENDING — exploratory / reviewer decision required |

## 4. Execution sequence

1. Record phone model, Android version, Windows version, app version, source commit, artifact filenames and SHA-256 hashes.
2. Install the APK and Windows installer. Confirm both show the expected AXIVESTRA build and no unrelated test environment.
3. Sign into the same dedicated non-production company on both devices.
4. Run DEV-01 through DEV-05 in order. Use synthetic records only and save redacted screenshots at each checkpoint.
5. Run DEV-06 and DEV-07 only where the app and test environment support them. Mark unsupported flows BLOCKED; do not silently mark them PASS.
6. Run DEV-08 as an exploratory conflict-behaviour check. Do not treat timestamp-based last-writer selection as a human conflict-resolution workflow.
7. Record every case as PASS, FAIL, BLOCKED or NOT TESTED, with timestamp, reproduction notes and redacted evidence link.
8. Clean up only the disposable QA records using the approved test-data cleanup process. Preserve evidence needed for defect investigation.

## 5. Acceptance conditions

R4 may be marked PASS only when DEV-01 through DEV-05 pass on actual devices, with no cross-company disclosure, silent data loss, duplicate creation or resurrection of a deleted test record. DEV-06 and DEV-07 must be reported separately according to supported product behaviour. DEV-08 must have a documented observed result and an explicit product decision about whether timestamp-based conflict selection is sufficient.

A successful unit test, Chromium mobile viewport, Android APK build or Windows installer build is not physical device acceptance.

## 6. Test record

- Tester:
- Date:
- Android device / OS:
- Windows device / OS:
- Android artifact / SHA-256:
- Windows artifact / SHA-256:
- Source commit:
- QA company identifier (non-sensitive):
- DEV-01 to DEV-08 results:
- Defects / reproduction:
- Evidence location:
- Overall R4 disposition: PENDING / PASS / FAIL / BLOCKED

Do not upload credentials, customer data, private contact information or unredacted database exports to the repository.
