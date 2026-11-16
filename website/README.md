# AXIVESTRA public website

A separate public-facing AXIVESTRA company website with a protected administrator workspace. It does not replace or modify the AXIVESTRA business app at https://axivestra.pages.dev.

## What is included

- Responsive public homepage with Platform, Solutions, About and Contact sections.
- Public enquiry form stored in Supabase.
- Admin sign-in at \`/admin\`.
- Editable brand name, tagline, homepage headline, introduction, contact information, logo URL and SEO metadata.
- Create, edit, publish and unpublish additional pages.
- Enquiry inbox with New / Contacted / Closed status.
- Domain and launch checklist.
- Public content reads and private admin operations protected by Supabase Row Level Security.

The public site starts with safe, non-sensitive default copy if Supabase is not yet configured. The contact form and administrator console require the database setup below.

## Open-source origin and licence

The implementation uses React, Vite, Supabase JS and Lucide React. A reusable website starter was evaluated before implementation:

- [CodeStitchOfficial / Intermediate-Astro-Decap-CMS](https://github.com/CodeStitchOfficial/Intermediate-Astro-Decap-CMS) — CC0-1.0.
- The upstream starter currently configures DecapBridge for its CMS login. That hosted authentication path is not included here; the AXIVESTRA website admin instead uses the existing Supabase Auth project and a database allowlist.
- This website is a separate React/Vite package so it can be deployed independently without changing the existing AXIVESTRA app build.

No paid theme, paid CMS subscription or proprietary website builder is required.

## Run locally

Requires Node.js 22 and npm.

\`\`\`bash
cd website
cp .env.example .env.local
# Add the AXIVESTRA Supabase project URL and public publishable key.
npm install
npm run dev
\`\`\`

Build and preview:

\`\`\`bash
npm run build
npm run preview
\`\`\`

## Supabase setup

Use the same Supabase project as AXIVESTRA, or a separate dedicated project if you prefer to isolate public website data.

1. In Supabase SQL Editor, run the complete file \`website/supabase/schema.sql\`.
2. Create or use the account that should administer the public website in **Authentication → Users**.
3. In SQL Editor, replace the email placeholder and run:

\`\`\`sql
insert into public.website_admins (user_id, role)
select id, 'owner'
from auth.users
where lower(email) = lower('YOUR_SUPABASE_LOGIN_EMAIL')
on conflict (user_id) do update set role = 'owner';
\`\`\`

4. Sign in at \`/admin\` with that Supabase Auth email and password.
5. To add another website administrator, run the same statement with that person's email and role \`'admin'\`.

Signing in alone does not grant website administration. Only an account provisioned in \`website_admins\` can edit pages, settings or enquiries. The browser uses only the Supabase publishable key; never add a service-role key to the website, GitHub Pages build variables or source files.

### Data boundaries

- Anyone can read the public website settings and pages marked \`published\`.
- Anyone can submit an enquiry with consent; public visitors cannot read enquiry records.
- Only provisioned website admins can list or update enquiries, manage website settings, or create/publish pages.
- Website administrator membership is readable only by the signed-in account itself.
- The website tables are separate from AXIVESTRA's property, finance, contact, legal and company records.

The enquiry form includes client validation, a honeypot field and database constraints. It does **not** yet include server-side rate limiting or CAPTCHA; add Cloudflare Turnstile or an equivalent server-verified control before promoting the form at high traffic.

## Free Cloudflare Pages deployment

The existing \`axivestra.pages.dev\` hostname is already used by the AXIVESTRA application. Create a **separate** Cloudflare Pages project for this website so the current application is not overwritten.

In Cloudflare:

1. Open **Workers & Pages → Create application → Pages → Connect to Git**.
2. Select the \`imtboss007/AXIVESTRA\` repository.
3. For the first preview, select branch \`feature/axivestra-public-website\`. Keep production deployment on an approved branch after review.
4. Set the root directory to \`website\`.
5. Set build command to \`npm run build\` and output directory to \`dist\`.
6. Add the environment variables \`VITE_SUPABASE_URL\` and \`VITE_SUPABASE_PUBLISHABLE_KEY\` using the same public client values as AXIVESTRA.
7. Deploy. Cloudflare Pages assigns a project-specific \`*.pages.dev\` address and HTTPS.

Suggested project name: \`axivestra-public\`. The resulting address would be \`https://axivestra-public.pages.dev\` **only if that Pages project name is available**; availability has not been checked or reserved.

Cloudflare Pages' free plan currently documents 500 builds per month, up to 20,000 files per site, and a 25 MiB maximum per individual site asset. Check Cloudflare's current limits before deployment: https://developers.cloudflare.com/pages/platform/limits/

## Custom domain

A \`pages.dev\` subdomain is the no-purchase option. A branded domain such as \`axivestra.com\` or \`www.axivestra.com\` must be registered separately; Cloudflare Pages hosting does not make the domain name itself free.

After you own a domain, add it under the website Pages project → **Custom domains** and follow the DNS instructions shown by Cloudflare. Do not point the existing AXIVESTRA app hostname at this new project.

Official instructions: https://developers.cloudflare.com/pages/configuration/custom-domains/

## Current limitations / launch gates

- The source code and database schema are prepared, but no Cloudflare Pages project has been created or deployed from this branch.
- The database schema must be applied and the first owner provisioned before admin sign-in can succeed.
- No domain name has been reserved. The proposed project name may already be taken.
- The public enquiry form is not protected by server-side rate limiting/CAPTCHA yet.
- Contact email and phone are intentionally blank until the owner enters verified contact details in Website Admin.
- The public website does not claim that external market, investor, court, valuation or screening feeds are connected.
- Run the website build and manual browser checks before merging or deploying.

## Deployment settings summary

| Setting | Value |
|---|---|
| Repository | \`imtboss007/AXIVESTRA\` |
| Preview branch | \`feature/axivestra-public-website\` |
| Root directory | \`website\` |
| Build command | \`npm run build\` |
| Output directory | \`dist\` |
| Required environment | \`VITE_SUPABASE_URL\`, \`VITE_SUPABASE_PUBLISHABLE_KEY\` |
| Admin route | \`/admin\` |
| Website data schema | \`website/supabase/schema.sql\` |
