/**
 * Run an application query under the authenticated database role and JWT claims
 * consumed by PostgREST-compatible RLS policies. Both settings are transaction-local.
 */
export async function withAuthenticatedRls(pool, claims, operation) {
  if (!claims || typeof claims.sub !== "string" || claims.role !== "authenticated") {
    throw new Error("A verified authenticated identity is required.");
  }
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SET LOCAL ROLE authenticated");
    await client.query(
      "SELECT set_config('request.jwt.claims', $1, true)",
      [JSON.stringify(claims)]
    );
    const result = await operation(client);
    await client.query("COMMIT");
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
