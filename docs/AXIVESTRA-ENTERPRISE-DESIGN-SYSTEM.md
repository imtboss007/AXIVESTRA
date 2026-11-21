# AXIVESTRA Enterprise Design System

**Status:** First implementation baseline on `feature/axivestra-enterprise-design`  
**Scope:** Visual presentation only. Existing business logic, data models, permissions, integrations and workflows remain authoritative.

## 1. Design direction

AXIVESTRA uses a **Pearl + Marine + Teal** visual identity:

- **Pearl canvas** gives the data-heavy workspace a calm, low-glare background.
- **Deep marine navigation** gives the application a stable institutional anchor.
- **Muted teal** is reserved for primary actions, selected states and focus.
- **Warm brass** is a restrained secondary accent for premium details, not a general-purpose status colour.
- White surfaces, quiet borders and subtle shadows replace layered neon gradients, strong glows and decorative glass effects.

The product should look like a serious asset, capital and relationship intelligence platform—not a generic AI landing page, a trading terminal or a gaming dashboard.

## 2. Colour tokens

| Token | Value | Usage |
|---|---|---|
| Canvas | `#F3F6F5` | Main application background |
| Surface | `#FFFFFF` | Cards, forms, dialogs and data panels |
| Surface alt | `#F8FAF9` | Secondary panels and inputs |
| Ink | `#20343D` | Primary text and headings |
| Body | `#3E535C` | Main supporting text |
| Muted | `#5B6D75` | Labels and secondary copy |
| Line | `#DCE5E4` | Standard borders/dividers |
| Marine | `#173746` | Sidebar and brand anchor |
| Primary teal | `#246A67` | Main buttons, focus and active states |
| Teal soft | `#E7F1EF` | Selected and informational surfaces |
| Brass | `#A77F48` | Small premium accent only |

Use dedicated semantic colours for success, warning and danger. Do not repurpose brass or teal to imply risk severity.

## 3. Component rules

1. One shared button hierarchy: primary for the main action, secondary for alternate actions, text button for low-emphasis navigation.
2. Cards use white surfaces, a one-pixel neutral border and restrained shadow. Do not add a gradient to every card.
3. Tables prioritise row readability, consistent alignment, sticky headers where useful, and clear sorting/filter state.
4. Forms use clear labels, helper text, visible focus and sufficient touch-target size.
5. Navigation is deep marine; the active destination uses a pale teal surface and dark text.
6. Dashboard metrics emphasise numbers and labels; decorative icons remain secondary.
7. Motion is brief and purposeful. Respect `prefers-reduced-motion`.
8. The orbital explorer may remain a distinct dark visualization surface, with lower saturation and no excessive glow.

## 4. Existing capability preservation

The theme is scoped to `.ax-modern-shell` and the existing authentication shell. It does not replace or restructure:

- The 16 domain workspaces.
- Property, contact, task, document, financial, risk, approval or follow-up records.
- Local-first IndexedDB/Dexie behaviour and backup/restore.
- Supabase authentication, company scope, roles, row-level security and sync.
- WhatsApp connection and automation workflows.
- Desktop Electron and Android Capacitor support.
- The functional orbital workspace explorer and its record-derived metrics.

## 5. Candidate open-source component inventory

The repositories below are component sources to evaluate, not wholesale applications to clone. Copy only the components needed, retain upstream attribution/licence notices and document any changes.

| Source | Proposed use | Adoption decision |
|---|---|---|
| [shadcn/ui](https://github.com/shadcn-ui/ui) | Accessible primitives and consistent component patterns | Preferred source; adapt to current React 18 stack |
| [Magic UI](https://github.com/magicuidesign/magicui) | Selected visual components and restrained effects | Per-component licence and dependency review required |
| [Motion Primitives](https://github.com/ibelick/motion-primitives) | Focused motion patterns | Check component licence and current peer dependencies |
| [Skiper UI](https://skiper-ui.com/) | Interaction and layout references | Verify commercial/free status per component |
| [Unlumen UI](https://unlumen.com/) | Micro-interactions and polished controls | Official source/licensing verification required before reuse |
| [SmoothUI](https://smoothui.dev/) | Motion-oriented controls | Verify React/Tailwind compatibility before reuse |
| [Animmaster Lib](https://www.animmasterlib.dev/) | Specific animation references | Confirm actual source package and licence before reuse |
| [ThreeUI](https://github.com/MengTo/threeui) | Selected 3D/WebGL experiences | Use sparingly; review asset/font terms separately |
| [AI Elements](https://github.com/vercel/ai-elements) | AI conversation and tool-call UI | Evaluate individual components against AG-UI |
| [Assistant UI](https://github.com/assistant-ui/assistant-ui) | Conversation interface patterns | Avoid introducing a competing agent runtime |
| [Vercel AI SDK](https://github.com/vercel/ai) | Streaming/tool patterns for a future gateway | Evaluate provider and runtime requirements |
| [CopilotKit](https://github.com/CopilotKit/CopilotKit) | Generative UI/agent interaction alternatives | Compare with existing AG-UI before selecting |
| [TanStack Table](https://github.com/TanStack/table) | Large data table capability | Preferred data-grid foundation if current tables need it |
| [Recharts](https://github.com/recharts/recharts) | Record-derived charts | Preferred chart candidate; verify version compatibility |
| [XYFlow](https://github.com/xyflow/xyflow) | Relationship and process graphs | Preferred workflow-visualisation candidate |

Ruflo and gstack are development orchestration/process tools, not runtime dependencies of the AXIVESTRA client. Their setup and agent permissions must be handled separately. Do not treat a free repository or a successful install as proof that model usage, hosting or premium components are free.

## 6. Delivery gates

- Visual: screenshots on desktop, tablet and Android; verify typography, contrast, responsive states and no horizontal overflow.
- Functional: run the complete existing test suite and E2E suite where configured.
- Build: run TypeScript and Vite production build.
- Data: confirm no schema, storage key, sync payload or record model changed.
- Access control: verify read-only role remains read-only; test cloud mode and local-only mode.
- Release: no merge to `main`, public deployment or production release without explicit approval.

## 7. Known verification boundary

The current change set adds the initial presentation layer and a static contract test. It does not claim that browser screenshots, physical Android testing, Electron packaging, or the production build have been executed. Those remain required before the redesign is considered fully validated.
