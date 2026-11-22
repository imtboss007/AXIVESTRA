import { isIP } from "node:net";
import { assertAllowedSourceUrl } from "../../supabase/functions/_shared/discovery-policy.mjs";

const IPV4_BLOCKED = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4]
];

function ipv4Number(value) {
  return value.split(".").reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0);
}
function inIpv4Range(address, base, prefix) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(base) & mask);
}

function ipv6Words(address) {
  let value = address.toLowerCase().split("%")[0];
  if (value.includes(".")) {
    const separator = value.lastIndexOf(":");
    const ipv4 = value.slice(separator + 1);
    if (isIP(ipv4) !== 4) return null;
    const parts = ipv4.split(".").map(Number);
    const high = ((parts[0] << 8) | parts[1]).toString(16);
    const low = ((parts[2] << 8) | parts[3]).toString(16);
    value = value.slice(0, separator + 1) + high + ":" + low;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array(missing).fill("0"), ...right].map(part => Number.parseInt(part || "0", 16));
  return words.length === 8 && words.every(word => Number.isInteger(word) && word >= 0 && word <= 0xffff) ? words : null;
}

function isSpecialUseIpv6(words) {
  const [a, b, c] = words;
  if (a === 0x2001) {
    if (b === 0x0000 || b === 0x0db8) return true; // Teredo and documentation
    if (b === 0x0002 && c === 0x0000) return true; // benchmarking 2001:2::/48
    if ([0x0010,0x0020,0x0030].includes(b & 0xfff0)) return true; // ORCHID special-use blocks
  }
  if (a === 0x2002) return true; // 6to4 transition
  if (a === 0x3fff && (b & 0xf000) === 0) return true; // 3fff::/20 documentation
  return false;
}

/** Accept only global-unicast IPv6 and reject IANA special-use ranges. */
export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !IPV4_BLOCKED.some(([base, prefix]) => inIpv4Range(address, base, prefix));
  if (family !== 6) return false;
  const words = ipv6Words(address);
  if (!words) return false;
  const first = words[0];
  if (first < 0x2000 || first > 0x3fff) return false;
  return !isSpecialUseIpv6(words);
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
  const specificity = group => Math.max(...group.agents.map(name => name === "*" ? 0 : name.length));
  const bestSpecificity = matching.reduce((best, group) => Math.max(best, specificity(group)), -1);
  const rules = matching.filter(group => specificity(group) === bestSpecificity).flatMap(group => group.rules);

  return Object.freeze({
    allows(urlValue) {
      const url = new URL(urlValue);
      const path = url.pathname + url.search;
      let best = null;
      for (const rule of rules) {
        const anchored = rule.path.endsWith("$");
        const raw = anchored ? rule.path.slice(0, -1) : rule.path;
        const pattern = raw.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + (anchored ? "$" : "");
        let matched = false;
        try { matched = new RegExp("^" + pattern).test(path); } catch { matched = false; }
        if (!matched) continue;
        const specificity = raw.replace(/\*/g, "").length;
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
