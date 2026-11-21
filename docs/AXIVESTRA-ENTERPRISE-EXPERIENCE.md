# AXIVESTRA Enterprise Experience Upgrade

**Branch:** \`feature/axivestra-enterprise-experience\` · **Base:** \`feature/axivestra-enterprise-design\`  
**Visual identity:** Night Marine + Teal + Brass

## Implemented
- Apache ECharts for Portfolio Analytics, loaded lazily.
- TanStack Table v8 + TanStack Virtual for Intelligence Hub search, sorting and virtual rows.
- React Hook Form + Zod for validated Follow-up form state, retaining existing save payload and INR conversion.
- Strict Generative UI schema and renderer: text, metric, record-link and action-preview blocks only.
- Human-review action preview with untrusted-source flag, recovery notes and typed confirmation for irreversible actions.
- Night Marine styles and a focused Node contract test added to the normal test command.

## Packages / licences
- \`echarts@^6.1.0\` — Apache-2.0.
- \`@tanstack/react-table@^8.21.3\` — MIT.
- \`@tanstack/react-virtual@^3.14.24\` — MIT.
- \`react-hook-form@^7.92.0\` — MIT.
- \`zod@^4.6.7\` — MIT.

No React 19 migration, Tailwind, Mantine or global UI framework rewrite. UI collections were treated as references rather than copied wholesale.

## Agent safety / deferred work
Existing AG-UI packages remain the protocol foundation. The renderer accepts bounded, Zod-validated components only. It does not execute HTML, scripts or model callbacks. Client approval callbacks do not execute actions. A future server must re-authorise authenticated identity, company scope, role, record scope, exact parameters and idempotency.

CopilotKit, A2UI and Vercel AI SDK await the secure agent gateway. Ruflo is a development harness, not runtime. GSAP/UI animation kits await concrete screen needs. React Flow, React Three Fiber/Drei and React Grid Layout await the process editor, 3D feature or customizable dashboard. Mantine is excluded to avoid a second design system. Design skills remain development-time tools. SmoothUI's React 19/Tailwind 4 setup does not match the current React 18 application.

## Verification
A focused Node integration test was added to \`npm test\`. TypeScript/Vite build, regression tests, browser/mobile checks, authenticated workspace checks and Windows/Android packaging still require CI/device execution. Local clone/build was not possible under current DNS/network restrictions. No merge or production release is authorised.
