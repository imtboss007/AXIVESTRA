/**
 * AXIVESTRA connector contract and bounded execution registry.
 * No connectors are registered by default and this module performs no
 * provider/network call until a reviewed adapter is explicitly registered.
 */

import { assertAllowedSourceUrl } from "./discovery-policy.mjs";
import {
  assertExecutionSession,
  assertPurposeAllowed
} from "./discovery-execution-policy.mjs";

export const CONNECTOR_KEYS = Object.freeze([
  "official_api",
  "licensed_api",
  "open_dataset",
  "permitted_public_page",
  "manual_research"
]);

export const CONNECTOR_CAPABILITIES = Object.freeze({
  official_api: ["search", "fetch_evidence"],
  licensed_api: ["search", "fetch_evidence"],
  open_dataset: ["search", "fetch_evidence"],
  permitted_public_page: ["search", "fetch_evidence"],
  manual_research: ["manual_entry"]
});

export class ConnectorRegistry {
  #connectors = new Map();

  register(connector) {
    if (!connector || !CONNECTOR_KEYS.includes(connector.key)) {
      throw new Error("Connector key is not supported.");
    }
    if (this.#connectors.has(connector.key)) throw new Error("A connector is already registered for " + connector.key + ".");
    if (connector.key === "manual_research") {
      if (typeof connector.recordManual !== "function") {
        throw new Error("A manual research connector must implement recordManual.");
      }
    } else if (typeof connector.search !== "function" || typeof connector.fetchEvidence !== "function") {
      throw new Error("A connector must implement search and fetchEvidence.");
    }
    this.#connectors.set(connector.key, Object.freeze(connector));
  }

  has(key) {
    return this.#connectors.has(key);
  }

  async search(source, query, context = {}) {
    assertUsableSource(source, "search");
    const purpose = assertPurposeAllowed(source, context.purpose);
    const session = assertExecutionSession(context.executionSession, source);
    const connector = this.#get(source.connector_key);
    const text = typeof query?.text === "string" ? query.text.trim() : "";
    const limit = Number(query?.limit ?? 10);
    if (!text || text.length > 500) throw new Error("Search text is required and must not exceed 500 characters.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error("Search result limit is outside the approved job bounds.");
    }
    const endpointUrl = assertAllowedSourceUrl(source, query?.endpointUrl || source.canonical_url);
    const { executionSession, ...safeContext } = context;
    const results = await session.run("search", ({ signal }) => connector.search({
      source,
      endpointUrl: endpointUrl.toString(),
      query: { ...query, text, limit },
      context: { ...safeContext, purpose, jobId: session.jobId, signal }
    }));
    if (Array.isArray(results) && results.length > limit) {
      throw new Error("The connector returned more results than the approved search limit.");
    }
    return results;
  }

  async fetchEvidence(source, candidate, context = {}) {
    assertUsableSource(source, "fetch_evidence");
    const purpose = assertPurposeAllowed(source, context.purpose);
    const session = assertExecutionSession(context.executionSession, source);
    const connector = this.#get(source.connector_key);
    const url = assertAllowedSourceUrl(source, candidate?.url);
    const { executionSession, ...safeContext } = context;
    return session.run("fetch_evidence", ({ signal }) => connector.fetchEvidence({
      source,
      candidate: { ...candidate, url: url.toString() },
      context: { ...safeContext, purpose, jobId: session.jobId, signal }
    }));
  }

  async recordManual(source, evidence, context = {}) {
    assertUsableSource(source, "manual_entry");
    const purpose = assertPurposeAllowed(source, context.purpose);
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) || JSON.stringify(evidence).length > 20000) {
      throw new Error("Manual evidence must be an object no larger than 20 KB.");
    }
    const connector = this.#get(source.connector_key);
    return connector.recordManual({ source, evidence, context: { ...context, purpose } });
  }

  #get(key) {
    const connector = this.#connectors.get(key);
    if (!connector) throw new Error("No implementation is installed for connector: " + key + ".");
    return connector;
  }
}

function assertUsableSource(source, capability) {
  if (!source || source.status !== "approved") throw new Error("Only an approved source can be used.");
  if (!CONNECTOR_KEYS.includes(source.connector_key)) throw new Error("Source connector is not supported.");
  if (!CONNECTOR_CAPABILITIES[source.connector_key].includes(capability)) throw new Error("The source connector does not support this operation.");
}
