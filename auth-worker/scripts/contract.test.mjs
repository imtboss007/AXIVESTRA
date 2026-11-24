import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const worker = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../migrations/0001_device_approval.sql", import.meta.url), "utf8");
const ownerPage = readFileSync(new URL("../../public/owner-access.html", import.meta.url), "utf8");
const accessPage = readFileSync(new URL("../../public/access.html", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../../functions/api/[[path]].ts", import.meta.url), "utf8");

assert.match(worker, /database:\s*env\.DB/, "Better Auth must use Cloudflare D1");
assert.match(worker, /socialProviders/, "Google OAuth must be supported");
assert.match(worker, /emailAndPassword:\s*\{\s*enabled:\s*true/, "Email/password registration must be enabled");
assert.match(worker, /OWNER_EMAIL/, "Owner identity must be configured server-side");
assert.match(worker, /emailVerified/, "Owner must use a verified Google email");
assert.match(worker, /SHA-256/, "Raw device IDs must not be stored");
assert.match(worker, /status !== "approved"/, "Private access must require approved device state");
assert.match(worker, /requireOwner/, "Owner actions must enforce owner identity");
assert.match(worker, /device_approved/, "Approval actions must be audit logged");
assert.match(schema, /status TEXT NOT NULL DEFAULT 'pending'/, "New devices must start pending");
assert.match(schema, /device_hash TEXT NOT NULL UNIQUE/, "Device identifiers must be stored as unique hashes");
assert.match(ownerPage, /\/api\/owner\/devices/, "Owner console must call owner-only device endpoint");
assert.match(ownerPage, /approve|reject|revoke/, "Owner console must expose device decisions");
assert.match(accessPage, /sign-up\/email/, "Access page must support email/password registration");
assert.match(accessPage, /sign-in\/social/, "Access page must support Google sign-in");
assert.match(accessPage, /register-device/, "Access page must register the current device for Owner approval");
assert.match(proxy, /AUTH_WORKER_URL/, "Same-origin Pages proxy must forward to the Worker");
console.log("AXIVESTRA D1 authentication contracts passed.");
