function boundedLimit(value) {
  const n = Number(value);
  return Number.isInteger(n) ? Math.max(1, Math.min(5, n)) : 5;
}

function validateBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("PHOTON_BASE_URL must be an absolute URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash) {
    throw new Error("Photon base URL must use HTTP(S) without credentials, query or fragment.");
  }
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("Non-local Photon endpoints must use HTTPS.");
  }
  return url;
}

export function createPhotonClient({
  baseUrl,
  fetchImpl = globalThis.fetch,
  userAgent = "AXIVESTRA-GeoResolution/1.0 (self-hosted Photon adapter)",
  timeoutMs = 5000
}) {
  const base = validateBaseUrl(baseUrl);
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  if (!userAgent || userAgent.length > 200) throw new Error("Photon adapter requires an identifying User-Agent.");
  const timeout = Math.max(500, Math.min(15000, Number(timeoutMs) || 5000));

  async function request(path, parameters) {
    const url = new URL(path.replace(/^\//, ""), base.toString().replace(/\/?$/, "/"));
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/geo+json, application/json", "User-Agent": userAgent },
        redirect: "error",
        signal: controller.signal
      });
      if (!response.ok) throw new Error("Photon returned HTTP " + response.status + ".");
      const body = await response.json();
      if (!body || !Array.isArray(body.features)) throw new Error("Photon returned an invalid GeoJSON feature collection.");
      return body.features;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async search(address, limit = 5) {
      const query = String(address?.formatted || "").trim();
      if (!query) return [];
      return request("/api", { q: query, limit: boundedLimit(limit), lang: "en" });
    },
    async reverse(latitude, longitude, limit = 5) {
      const lat = Number(latitude), lon = Number(longitude);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
          !Number.isFinite(lon) || lon < -180 || lon > 180) {
        throw new Error("Photon reverse geocoding requires valid latitude and longitude.");
      }
      return request("/reverse", { lat, lon, limit: boundedLimit(limit), lang: "en" });
    }
  };
}

function cleanText(value, maximum = 300) {
  return typeof value === "string" ? value.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, maximum) : null;
}

function safeCoordinate(value, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

export function normalizePhotonFeatures(features, address) {
  if (!Array.isArray(features)) return [];
  return features.slice(0, 5).flatMap(feature => {
    const coordinates = feature?.geometry?.coordinates;
    const longitude = Array.isArray(coordinates) ? safeCoordinate(coordinates[0], -180, 180) : null;
    const latitude = Array.isArray(coordinates) ? safeCoordinate(coordinates[1], -90, 90) : null;
    if (latitude === null || longitude === null) return [];
    const p = feature.properties || {};
    const comparison = scorePhotonAddressMatch(address, p);
    return [{
      latitude, longitude,
      name: cleanText(p.name),
      street: cleanText(p.street),
      house_number: cleanText(p.housenumber),
      postcode: cleanText(p.postcode),
      locality: cleanText(p.district || p.suburb),
      city: cleanText(p.city),
      state: cleanText(p.state),
      country: cleanText(p.country),
      country_code: cleanText(p.countrycode, 2)?.toUpperCase() || null,
      osm_type: cleanText(p.osm_type, 20),
      osm_id: p.osm_id == null ? null : String(p.osm_id).slice(0, 40),
      osm_key: cleanText(p.osm_key, 80),
      osm_value: cleanText(p.osm_value, 80),
      result_type: cleanText(p.type, 40),
      component_match_score: comparison.score,
      component_match_method: comparison.method,
      matched_address_components: comparison.matched,
      supplied_address_components: comparison.supplied,
      attribution: "© OpenStreetMap contributors"
    }];
  });
}

export async function enrichPlaceWithPhoton(candidate, photonClient) {
  if (candidate.source_coordinates || !candidate.address?.formatted) return candidate;
  const features = await photonClient.search(candidate.address, 5);
  const providerCandidates = normalizePhotonFeatures(features, candidate.address);
  return {
    ...candidate,
    provider: "photon_self_hosted",
    provider_candidates: providerCandidates,
    provider_attribution: providerCandidates.length ? "© OpenStreetMap contributors" : null,
    candidate_state: providerCandidates.length ? "geocoder_candidates_pending_review" : "geocoder_no_match"
  };
}
