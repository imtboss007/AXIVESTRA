# Open-source provenance

## Template evaluated

- Project: [CodeStitchOfficial/Intermediate-Astro-Decap-CMS](https://github.com/CodeStitchOfficial/Intermediate-Astro-Decap-CMS)
- Licence: CC0-1.0 (verified in the upstream GitHub repository metadata).
- Reason evaluated: maintained Astro business-site starter with a multi-page website structure and a CMS administration route.
- Integration decision: do not reuse its DecapBridge identity/gateway configuration. The AXIVESTRA site uses its own Supabase Auth + RLS admin allowlist, avoiding an additional hosted CMS-auth dependency. The website remains a separate deployable package.

## Direct website dependencies

- React / React DOM — MIT.
- Vite — MIT.
- Supabase JS — MIT.
- Lucide React — ISC.

Respect the licence files and notices of any dependency version installed by npm. Do not copy third-party images or fonts from the evaluated starter into AXIVESTRA without separately checking their asset licences. The AXIVESTRA visual identity and website copy are newly authored for this project.
