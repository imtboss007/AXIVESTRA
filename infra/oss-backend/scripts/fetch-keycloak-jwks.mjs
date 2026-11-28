import { dirname } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const url = process.env.KEYCLOAK_JWKS_URL
  || "http://keycloak:8080/realms/axivestra/protocol/openid-connect/certs";
const output = process.env.JWKS_OUTPUT || "/run/secrets/keycloak-jwks.json";
const deadline = Date.now() + 120_000;
let lastError = "Keycloak did not become ready.";

while (Date.now() < deadline) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error("JWKS endpoint returned HTTP " + response.status);
    const document = await response.json();
    const keys = Array.isArray(document.keys)
      ? document.keys.filter(key => key.use === "sig" && key.kty === "RSA" && key.alg === "RS256")
      : [];
    if (!keys.length) throw new Error("Keycloak has not published an RS256 signing key yet.");
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify({ keys }), { mode: 0o440 });
    process.stdout.write("Loaded " + keys.length + " Keycloak RS256 verification key(s).\n");
    process.exit(0);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
}

process.stderr.write("Could not load Keycloak JWKS: " + lastError + "\n");
process.exit(1);
