import { isIP } from "node:net";
import { assertAllowedSourceUrl } from "../../supabase/functions/_shared/discovery-policy.mjs";

const IPV4_BLOCKED = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
];

function ipv4Number(value) {
  return value.split(".").reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0);
}

function inIpv4Range(address, base, prefix) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(base) & mask);
}

function ipv6FirstHextet(address) {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized.startsWith("::ffff:")) {
    const tail = normalized.slice(7);
    if (isIP(tail) === 4) return { mappedIpv4: tail };
  }
  const first = normalized.split(":").find(Boolean);
  return { first: Number.parseInt(first || "0", 16), normalized };
}

/** Reject every non-global address before opening a socket. */
export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !IPV4_BLOCKED.some(([base, prefix]) => inIpv4Range(address, base, prefix));
  if (family !== 6) return false;
  const parsed = ipv6FirstHextet(address);
  if (parsed.mappedIpv4) return isPublicAddress(parsed.mappedIpv4);
  const value = parsed.first;
  // Only global-unicast 2000::/3 is accepted. Block documentation, transition,
  // benchmarking and special-use subranges as well.
  if (value < 0x2000 || value > 0x3fff) return false;
  const normalized = parsed.normalized;
  if (normalized.startsWith("2001:db8:") || normalized.startsWith("2001:0000:") || normalized.startsWith("2002:")) return false;
  return true;
}

export function assertPublicResolvedAddresses(addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) throw new Error("DNS resolution returned no public address.");
  if (addresses.some(item => !isPublicAddress(item.address))) {
    throw new Error("The source hostname resolved to a private or reserved network address; request blocked.");
  }
  return addresses[0];
}

export function redactUrl(value) {
  const url = new URL(value);
  for (const key of url.searchParams.keys()) url.searchParams.set(key, "[redacted]");
  url.username = "";
  url.password = "";
  url.hash = "";
  return url.toString();
}

export function parseRobotsRules(content, userAgent = "AXIVESTRA-DiscoveryBot") {
  const groups = [];
  let current = null;
  const finishIfNeeded = () => {
    if (!current) current = { agents: [], rules: [] };
  };
  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0].trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (current && current.rules.length) {
        groups.push(current);
        current = null;
      }
      finishIfNeeded();
      current.agents.push(value.toLowerCase());
    } else if (key === "allow" || key === "disallow") {
      finishIfNeeded();
      if (value) current.rules.push({ allow: key === "allow", path: value });
    }
  }
  if (current?.agents.length) groups.push(current);

  const agent = userAgent.toLowerCase();
  const matching = groups.filter(group => group.agents.some(name => name === "*" || agent.includes(name)));
  const bestSpecificity = matching.reduce((best, group) => Math.max(best, ...group.agents.map(name => name === "*" ? 0 : name.length)), -1);
  const rules = matching
    .filter(group => group.agents.some(name => (name === "*" ? 0 : name.length) === bestSpecificity))
    .flatMap(group => group.rules);

  return Object.freeze({
    allows(urlValue) {
      const path = new URL(urlValue).pathname + new URL(urlValue).search;
      let best = null;
      for (const rule of rules) {
        const pattern = rule.path
          .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\\\*/g, ".*")
          .replace(/\\\$/g, "$");
        let matched = false;
        try { matched = new RegExp("^" + pattern).test(path); } catch { matched = false; }
        if (!matched) continue;
        const specificity = rule.path.replace(/[\\*$]/g, "").length;
        if (!best || specificity > best.specificity || (specificity === best.specificity && rule.allow)) {
          best = { specificity, allow: rule.allow };
        }
      }
      return best ? best.allow : true;
    }
  });
}

export function validateCandidateUrls(source, values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > Number(source?.max_pages_per_job || 0)) {
    throw new Error("A discovery job must contain 1 to the approved maximum number of candidate URLs.");
  }
  const urls = [...new Set(values.map(value => {
    if (typeof value !== "string" || value.length > 2048) throw new Error("Candidate URLs must be valid HTTPS URLs no longer than 2048 characters.");
    return assertAllowedSourceUrl(source, value).toString();
  }))];
  if (urls.length !== values.length) throw new Error("Duplicate candidate URLs are not allowed in one discovery job.");
  return urls;
}

export function makeRobotsUrl(source) {
  const base = new URL(source.canonical_url);
  return new URL("/robots.txt", base.origin).toString();
}
