# AXIVESTRA E09 — Geo Resolution & Spatial Context

**Status:** Engineering implementation on `feat/discovery-e09-geo-resolution`, based on E08. No geocoder is enabled by default and no source or migration is activated in production.

## Matrix scope

E09 normalises address, city, state, country and coordinates, with optional route/area context. A geocode is place context only; it is never treated as ownership, title or parcel-rights evidence.

## Implemented

- Extracts address and coordinate facts only from E05 facts that are valid, source-spanned and explicitly allow-listed by the E02 source field schema.
- Processes organization and location mentions only. Person entities and personal residential address enrichment are excluded.
- Normalises address components without filling in missing city, state, country or postal code.
- Validates country-code format through the runtime region-name database; invalid country codes are left null and country text is not converted into a code.
- Requires both latitude and longitude, validates geographic ranges, and keeps source-provided coordinates distinct from provider candidates.
- Adds an optional Photon adapter for a **self-hosted** instance only. It uses an explicit configured URL, bounded results, a custom User-Agent, HTTPS for non-loopback hosts, redirect rejection and a request timeout.
- Photon results retain OSM identifiers, a transparent exact-component-overlap score and required `© OpenStreetMap contributors` attribution. The overlap ratio is not represented as a statistical probability.
- Photon calls occur only when the operator explicitly enables Photon and the approved source purpose explicitly includes `geocoding`. The feature worker itself is disabled by default.
- Owner/admin review is required before a place candidate is accepted. Review snapshots exclude address text and coordinates so audit receipts can survive evidence retention without retaining the original location payload.

## Provider and licensing decision

Photon is Apache-2.0 software. Its underlying OpenStreetMap data is ODbL and requires suitable attribution. AXIVESTRA uses a configurable self-hosted Photon URL; it does not rely on the public demo as a production API. See the [Photon API](https://github.com/komoot/photon/blob/master/docs/api-v1.md), [Photon repository](https://github.com/komoot/photon) and [OpenStreetMap attribution](https://www.openstreetmap.org/copyright).

The public Nominatim endpoint is not used. Its usage policy sets limits and expressly discourages bulk/periodic geocoding, autocomplete, and use of personal or confidential material. See the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/).

## Worker configuration

- `DISCOVERY_GEO_RESOLUTION_WORKER_ENABLED=true` enables the server-side worker.
- `DISCOVERY_PHOTON_ENABLED=true` separately enables the optional Photon adapter.
- `PHOTON_BASE_URL` must point to a self-hosted Photon instance; non-loopback endpoints must use HTTPS.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are server-side only.

No external request is made when either the worker or Photon switch is off. A source must separately include the `geocoding` purpose for Photon calls.

## Boundaries and remaining work

- No cadastral/parcel identification, title verification, property valuation, ownership inference, routing, travel-time calculation or area-based risk score is implemented in E09.
- No bulk OSM download or public Photon/Nominatim API dependency is enabled.
- E09 produces candidates; it does not auto-link locations to legal entities or overwrite source address facts.
- UI map rendering and routing/area context remain later integration work after E09 candidate review and E11/E15 consumer workflows.
