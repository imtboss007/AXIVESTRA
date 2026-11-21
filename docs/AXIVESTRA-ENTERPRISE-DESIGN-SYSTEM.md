# AXIVESTRA Enterprise Design System

**Status:** Dark visual baseline on `feature/axivestra-enterprise-design`  
**Scope:** Presentation only. Existing business logic, data models, permissions, integrations and workflows remain authoritative.

## 1. Design direction

AXIVESTRA uses a **Night Marine + Teal + Brass** identity: a dark, premium, institutional asset-intelligence platform. It should feel like a serious capital, property and relationship operating system—not a generic AI landing page, trading terminal or gaming dashboard.

- **Night canvas:** deep blue-black workspace background to reduce glare.
- **Marine surfaces:** layered navy/slate panels with clear elevation and restrained borders.
- **Muted teal:** primary actions, selected navigation, focus and active data states.
- **Warm brass:** limited premium accent for selected highlights only.
- **Soft cool text:** high-contrast headings and readable supporting labels.
- No neon glow stacks, oversaturated cyan, decorative glass panels or unnecessary gradients.

## 2. Colour tokens

| Token | Value | Usage |
|---|---|---|
| Canvas | `#0B1420` | Main application background |
| Surface | `#132333` | Cards, forms and data panels |
| Surface alt | `#172B3C` | Secondary and raised panels |
| Ink | `#E8F0F4` | Main text and headings |
| Body | `#C3D1DA` | Supporting copy |
| Muted | `#9AAFBD` | Labels and secondary text |
| Line | `#294052` | Borders and dividers |
| Deep marine | `#091725` | Navigation and brand anchor |
| Primary teal | `#3B9189` | Main actions and focus |
| Teal hover | `#4AA79D` | Hover and active emphasis |
| Teal soft | `#183B40` | Selected and informational surfaces |
| Brass | `#B99A68` | Restrained premium accent |

Use separate semantic colours for success, warning, danger, approvals and risk severity. Never use teal or brass to imply a risk score.

## 3. Component rules

1. One shared button hierarchy: teal primary, marine/slate secondary, quiet text action.
2. Cards use dark surfaces, restrained one-pixel borders and subtle shadows.
3. Tables prioritise row readability, consistent alignment, clear sort/filter state and visible hover.
4. Forms use dark inputs, clear labels, visible focus and sufficient touch-target size.
5. Navigation stays deep marine; selected destinations use a subdued teal surface and clear text.
6. Dashboard metrics emphasise numbers and labels; decorative icons remain secondary.
7. Motion is brief and purposeful. Respect `prefers-reduced-motion`.
8. The orbital explorer remains a dark visualization surface, with low-saturation teal and no excessive glow.
9. Authentication, account creation, recovery and company selection must share the same dark marine system—no separate white login theme.

## 4. Existing capability preservation

The visual layer does not replace or restructure the 16 domain workspaces, property/contact/task/document/financial/risk/approval/follow-up records, Dexie local-first behaviour, Supabase authentication/company scope/RLS/sync, WhatsApp workflows, Electron desktop, Android Capacitor or functional orbital explorer.

## 5. Open-source component inventory

These are component sources to evaluate, not wholesale applications to clone. Adopt only useful components, retain licence notices and check React 18 compatibility before adding dependencies.

| Source | Proposed use | Adoption decision |
|---|---|---|
| [shadcn/ui](https://github.com/shadcn-ui/ui) | Accessible primitives | Preferred source; adapt to current stack |
| [Magic UI](https://github.com/magicuidesign/magicui) | A few restrained effects | Review component licence and dependencies |
| [Motion Primitives](https://github.com/ibelick/motion-primitives) | Focused motion | Check licence and peer dependencies |
| [Skiper UI](https://skiper-ui.com/) | Interaction references | Verify free/commercial terms per component |
| [Unlumen UI](https://github.com/leovvx/unlumen-ui-docs) | Micro-interaction references | Verify actual source/licensing |
| [SmoothUI](https://github.com/educlopez/smoothui) | Motion controls | Check compatibility |
| [Animmaster Lib](https://github.com/manaogabs/animmaster-library) | Animation references | Verify source package and licence |
| [ThreeUI](https://github.com/MengTo/threeui) | Selected 3D experiences | Use sparingly; review asset terms |
| [AI Elements](https://github.com/vercel/ai-elements) | AI conversation UI | Evaluate against AG-UI |
| [Assistant UI](https://github.com/assistant-ui/assistant-ui) | Conversation patterns | Avoid competing agent runtime |
| [TanStack Table](https://github.com/TanStack/table) | Data tables | Preferred if current tables need it |
| [Recharts](https://github.com/recharts/recharts) | Data visualisation | Verify version compatibility |
| [XYFlow](https://github.com/xyflow/xyflow) | Relationship and process graphs | Preferred workflow visualisation candidate |

Ruflo and gstack are development orchestration tools, not client runtime dependencies. No deployment, merge to main or public release is authorised by this visual update.

## 6. Delivery gates

- Visual: desktop, tablet and Android screenshots; check contrast, responsive states and horizontal overflow.
- Functional: run existing regression and E2E suites where configured.
- Build: run TypeScript and Vite production build.
- Data: no schema, storage key, sync payload or record model changes.
- Access: preserve read-only roles, company isolation and local-only mode.
- Release: no merge to `main` or production release without explicit approval.
