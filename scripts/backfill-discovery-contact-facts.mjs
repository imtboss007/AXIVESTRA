import { createClient } from "@supabase/supabase-js";
import {
  encryptContactValue,
  keyFromBase64,
  maskContactValue
} from "../services/discovery-worker/contact-validation.mjs";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Missing required backfill environment variable: " + name);
  return value;
}

const apply = process.env.DISCOVERY_E05_CONTACT_BACKFILL_APPLY === "true";
const pageSize = Math.max(25, Math.min(500, Number(process.env.DISCOVERY_E05_CONTACT_BACKFILL_PAGE_SIZE || 100)));
const client = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
});
const encryptionKey = keyFromBase64(requiredEnv("DISCOVERY_CONTACT_ENCRYPTION_KEY"), "DISCOVERY_CONTACT_ENCRYPTION_KEY");
const fingerprintKey = keyFromBase64(requiredEnv("DISCOVERY_CONTACT_FINGERPRINT_KEY"), "DISCOVERY_CONTACT_FINGERPRINT_KEY");

function redactSpan(value, masked) {
  const span = value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
  delete span.quoteHash;
  span.quote = masked;
  span.quoteRedacted = true;
  return span;
}

async function run() {
  console.info("AXIVESTRA E05 contact backfill mode:", apply ? "APPLY" : "DRY RUN");
  let offset = 0;
  let scanned = 0;
  let ready = 0;
  let updated = 0;
  let skipped = 0;

  while (true) {
    const { data, error } = await client.from("discovery_extracted_facts")
      .select("id,company_id,value_type,raw_value,source_span,raw_value_ciphertext")
      .in("value_type", ["email", "phone"])
      .is("raw_value_ciphertext", null)
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error("Could not read legacy E05 contact facts: " + error.message);
    const rows = data || [];
    if (!rows.length) break;
    scanned += rows.length;

    for (const row of rows) {
      const raw = typeof row.raw_value === "string" ? row.raw_value.normalize("NFKC").trim() : "";
      if (!raw || raw.length > 320) {
        skipped += 1;
        throw new Error("Legacy contact row " + row.id + " is empty or oversized; review it before validating the encryption constraint.");
      }
      const encrypted = encryptContactValue(raw, encryptionKey, fingerprintKey);
      const masked = maskContactValue(row.value_type, raw);
      const update = {
        raw_value: masked,
        normalized_value: null,
        source_span: redactSpan(row.source_span, masked),
        raw_value_ciphertext: encrypted.value_ciphertext,
        raw_value_nonce: encrypted.value_nonce,
        raw_value_auth_tag: encrypted.value_auth_tag,
        raw_value_fingerprint: encrypted.value_fingerprint,
        raw_value_encryption_version: encrypted.encryption_version
      };
      ready += 1;
      if (!apply) continue;
      const { data: changed, error: updateError } = await client.from("discovery_extracted_facts")
        .update(update)
        .eq("company_id", row.company_id)
        .eq("id", row.id)
        .is("raw_value_ciphertext", null)
        .select("id")
        .maybeSingle();
      if (updateError) throw new Error("Could not encrypt legacy E05 row " + row.id + ": " + updateError.message);
      if (changed) updated += 1;
    }

    offset += rows.length;
    if (rows.length < pageSize) break;
  }

  const { count, error: countError } = await client.from("discovery_extracted_facts")
    .select("id", { count: "exact", head: true })
    .in("value_type", ["email", "phone"])
    .is("raw_value_ciphertext", null);
  if (countError) throw new Error("Could not verify E05 backfill completion: " + countError.message);

  console.info("AXIVESTRA E05 contact backfill result:", JSON.stringify({
    mode: apply ? "apply" : "dry_run",
    scanned,
    ready,
    updated,
    skipped,
    remainingLegacyRows: count ?? null
  }));
  if (apply && (count || 0) > 0) {
    throw new Error("E05 backfill is incomplete. Rerun this idempotent script until remainingLegacyRows is zero.");
  }
  if (!apply) {
    console.info("Dry run only. Set DISCOVERY_E05_CONTACT_BACKFILL_APPLY=true to write ciphertext and masked values.");
  } else {
    console.info("Backfill complete. Validate with: ALTER TABLE public.discovery_extracted_facts VALIDATE CONSTRAINT discovery_extracted_facts_contact_encryption_check;");
  }
}

run().catch(error => {
  console.error("AXIVESTRA E05 contact backfill stopped safely:", String(error?.message || error));
  process.exitCode = 1;
});
