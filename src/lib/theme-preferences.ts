export type ThemeMode = "dark" | "light" | "system";
export type ThemeId =
  | "signature" | "titanium" | "obsidian" | "sapphire" | "carbon"
  | "platinum" | "arctic" | "sand" | "violet" | "custom";
export type ThemePalette = {
  background: string; surface: string; raised: string; panel: string; sidebar: string;
  border: string; primary: string; secondary: string; accent: string; text: string;
  muted: string; active: string; buttonText: string; chart: string; graph: string;
};
export type ThemePreferences = {
  version: 1; id: ThemeId; appearance: ThemeMode;
  palettes: { dark: ThemePalette; light: ThemePalette };
};

export const THEME_STORAGE_KEY = "axivestra.themePreferences.v1";
export const THEME_COLOR_FIELDS: Array<{ key: keyof ThemePalette; label: string; hint: string }> = [
  { key: "primary", label: "Primary", hint: "Main actions and emphasis" },
  { key: "secondary", label: "Secondary", hint: "Secondary controls and supporting accents" },
  { key: "accent", label: "Accent", hint: "Highlights and selected details" },
  { key: "background", label: "Background", hint: "Application canvas" },
  { key: "surface", label: "Surface", hint: "Cards and primary panels" },
  { key: "raised", label: "Raised surface", hint: "Inputs, nested panels and hover states" },
  { key: "panel", label: "Panel", hint: "Large work areas and data panels" },
  { key: "sidebar", label: "Sidebar", hint: "Main navigation background" },
  { key: "border", label: "Borders", hint: "Dividers and control outlines" },
  { key: "text", label: "Primary text", hint: "Headings and important values" },
  { key: "muted", label: "Muted text", hint: "Descriptions and supporting labels" },
  { key: "active", label: "Active state", hint: "Selected navigation and filters" },
  { key: "buttonText", label: "Button text", hint: "Text on primary actions" },
  { key: "chart", label: "Chart colour", hint: "Data series and indicators" },
  { key: "graph", label: "Graph colour", hint: "Relationship and network highlights" }
];

const palettes: Record<Exclude<ThemeId, "custom">, { dark: ThemePalette; light: ThemePalette }> = {
  signature: {
    dark: { background:"#101a14",surface:"#18251c",raised:"#22332a",panel:"#1c3023",sidebar:"#11291c",border:"#385144",primary:"#5b8e6c",secondary:"#a1bca3",accent:"#e0c28b",text:"#eef6ef",muted:"#adc0b0",active:"#294b35",buttonText:"#ffffff",chart:"#79b68a",graph:"#dfb27c" },
    light: { background:"#f7f7f2",surface:"#ffffff",raised:"#f0f3eb",panel:"#f3f5ef",sidebar:"#17382a",border:"#e0e8dd",primary:"#1b4932",secondary:"#66836b",accent:"#bc945b",text:"#20362a",muted:"#737f75",active:"#e1edda",buttonText:"#ffffff",chart:"#4e856d",graph:"#c49756" }
  },
  titanium: {
    dark: { background:"#10161b",surface:"#182129",raised:"#222e38",panel:"#1c2a34",sidebar:"#0c1720",border:"#34454f",primary:"#7da0b8",secondary:"#9ab0bd",accent:"#30bed5",text:"#ebf4f7",muted:"#9bb0bb",active:"#293e4b",buttonText:"#071b22",chart:"#71bfd0",graph:"#e0a56f" },
    light: { background:"#eef2f5",surface:"#ffffff",raised:"#e7ecef",panel:"#f4f6f7",sidebar:"#222c34",border:"#d6dee3",primary:"#546e82",secondary:"#718795",accent:"#0f8ea9",text:"#29343c",muted:"#697984",active:"#dbe9ed",buttonText:"#ffffff",chart:"#287f98",graph:"#b8733e" }
  },
  obsidian: {
    dark: { background:"#070d0b",surface:"#0f1914",raised:"#17271f",panel:"#13231b",sidebar:"#06110d",border:"#293e34",primary:"#4eb28b",secondary:"#9bbcaf",accent:"#bfd5c8",text:"#e8f5ee",muted:"#96ada1",active:"#1c3d2f",buttonText:"#071b14",chart:"#63cf9e",graph:"#c4d8ce" },
    light: { background:"#eef5f1",surface:"#ffffff",raised:"#e4eee8",panel:"#f4f8f5",sidebar:"#10271d",border:"#d6e4db",primary:"#187a58",secondary:"#5c8370",accent:"#8caf9b",text:"#1b3025",muted:"#6c8275",active:"#dceee4",buttonText:"#ffffff",chart:"#25865f",graph:"#769b87" }
  },
  sapphire: {
    dark: { background:"#071323",surface:"#101f35",raised:"#182b48",panel:"#132743",sidebar:"#071629",border:"#28405e",primary:"#5b91d4",secondary:"#a1bbdf",accent:"#9ac0ff",text:"#e7f0ff",muted:"#9eb0c8",active:"#1a3558",buttonText:"#06182c",chart:"#6fa8f1",graph:"#c0d7ff" },
    light: { background:"#eff4fb",surface:"#ffffff",raised:"#e8eff8",panel:"#f4f7fc",sidebar:"#172c49",border:"#d8e1ee",primary:"#315f9b",secondary:"#6882a8",accent:"#5a83bd",text:"#233449",muted:"#6c7f98",active:"#dce8f8",buttonText:"#ffffff",chart:"#3c75b8",graph:"#91acd2" }
  },
  carbon: {
    dark: { background:"#111516",surface:"#191f21",raised:"#242c2e",panel:"#202829",sidebar:"#0d1213",border:"#3a4748",primary:"#ee8a3e",secondary:"#a7b5b4",accent:"#ffb45f",text:"#f2f5f4",muted:"#a0afae",active:"#3b3025",buttonText:"#18120c",chart:"#f29b52",graph:"#ffd29a" },
    light: { background:"#f4f4f2",surface:"#ffffff",raised:"#eaeceb",panel:"#f7f8f6",sidebar:"#263034",border:"#d9dfdd",primary:"#bd6120",secondary:"#667775",accent:"#e28a36",text:"#283432",muted:"#687976",active:"#f8e6d6",buttonText:"#ffffff",chart:"#bd6120",graph:"#9c6b3c" }
  },
  platinum: {
    dark: { background:"#141a24",surface:"#1e2633",raised:"#293448",panel:"#232d3e",sidebar:"#101722",border:"#3a465a",primary:"#9caec7",secondary:"#b5c0d0",accent:"#d3dde9",text:"#f2f5fa",muted:"#aab6c7",active:"#303f57",buttonText:"#0b1724",chart:"#96b2d5",graph:"#d4e1ef" },
    light: { background:"#f5f7fa",surface:"#ffffff",raised:"#edf1f5",panel:"#f7f9fb",sidebar:"#24364b",border:"#dbe2e9",primary:"#3d5675",secondary:"#647b96",accent:"#8ca0b8",text:"#233449",muted:"#687a8a",active:"#dde6ef",buttonText:"#ffffff",chart:"#496b91",graph:"#8299b5" }
  },
  arctic: {
    dark: { background:"#091b24",surface:"#102833",raised:"#183743",panel:"#142f3b",sidebar:"#081c25",border:"#284c58",primary:"#4cb3cf",secondary:"#8ecbd9",accent:"#a7e7f4",text:"#e8f8fc",muted:"#9ebac4",active:"#204758",buttonText:"#06202a",chart:"#6bcbe0",graph:"#b5edf8" },
    light: { background:"#f2fafc",surface:"#ffffff",raised:"#eaf5f8",panel:"#f5fafb",sidebar:"#103748",border:"#d5e7ec",primary:"#278ca7",secondary:"#5c7d89",accent:"#44b5d0",text:"#243d47",muted:"#738b94",active:"#dceff3",buttonText:"#ffffff",chart:"#278ca7",graph:"#70aebd" }
  },
  sand: {
    dark: { background:"#201b15",surface:"#2c251d",raised:"#393025",panel:"#332c22",sidebar:"#1b1712",border:"#55483a",primary:"#b89a69",secondary:"#c7b18c",accent:"#e4c894",text:"#f5eee1",muted:"#bcae98",active:"#4a3a28",buttonText:"#24180e",chart:"#c3a06a",graph:"#e6cda2" },
    light: { background:"#f7f3eb",surface:"#fffdf7",raised:"#f1eadc",panel:"#f6f0e4",sidebar:"#3b3024",border:"#e4dac8",primary:"#8a6b3c",secondary:"#ab916a",accent:"#c39d60",text:"#2e291f",muted:"#857966",active:"#e9dfcd",buttonText:"#ffffff",chart:"#a18250",graph:"#b8915b" }
  },
  violet: {
    dark: { background:"#171426",surface:"#211c36",raised:"#2d2746",panel:"#29223f",sidebar:"#121020",border:"#443b61",primary:"#9a83d5",secondary:"#b5a7de",accent:"#c6b7ff",text:"#f3efff",muted:"#b4accd",active:"#3b315d",buttonText:"#151027",chart:"#ad9ae8",graph:"#d2c4ff" },
    light: { background:"#f4f0fc",surface:"#ffffff",raised:"#ece6f7",panel:"#f7f4fc",sidebar:"#2a2142",border:"#e2daf0",primary:"#7256b4",secondary:"#8e7db4",accent:"#9a80d9",text:"#2b2440",muted:"#817795",active:"#eae3f7",buttonText:"#ffffff",chart:"#8069bd",graph:"#b3a2e5" }
  }
};

export const THEME_PRESETS: Array<{ id: Exclude<ThemeId, "custom">; name: string; description: string }> = [
  { id:"signature",name:"AXIVESTRA Signature",description:"Forest green, cream and natural white" },
  { id:"titanium",name:"Titanium Graphite",description:"Graphite, titanium and electric blue" },
  { id:"obsidian",name:"Obsidian Emerald",description:"Deep black, emerald and platinum" },
  { id:"sapphire",name:"Midnight Sapphire",description:"Navy, sapphire and silver" },
  { id:"carbon",name:"Carbon Precision",description:"Charcoal, precision orange and light grey" },
  { id:"platinum",name:"Platinum Light",description:"White, platinum and deep navy" },
  { id:"arctic",name:"Arctic Ice",description:"Ice white, cool grey and blue" },
  { id:"sand",name:"Warm Sand",description:"Warm beige, stone and dark green" },
  { id:"violet",name:"Deep Violet",description:"Midnight violet and silver" }
];

const isHex = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
const copyPalette = (palette: ThemePalette): ThemePalette => ({ ...palette });
const copyPalettes = (value: { dark: ThemePalette; light: ThemePalette }) => ({
  dark: copyPalette(value.dark), light: copyPalette(value.light)
});

export function createThemePreferences(id: ThemeId, appearance: ThemeMode = "system", basePalette?: ThemePalette): ThemePreferences {
  if (id === "custom") {
    const base = basePalette ? copyPalette(basePalette) : copyPalette(palettes.signature.light);
    return { version:1,id,appearance,palettes:{ dark:copyPalette(base),light:copyPalette(base) } };
  }
  return { version:1,id,appearance,palettes:copyPalettes(palettes[id]) };
}

export function normalizeThemePreferences(raw: unknown): ThemePreferences | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<ThemePreferences>;
  if (value.version !== 1 || !value.id || !(value.id === "custom" || value.id in palettes)) return null;
  if (!["dark","light","system"].includes(String(value.appearance))) return null;
  const rawPalettes = value.palettes as ThemePreferences["palettes"] | undefined;
  if (!rawPalettes || !rawPalettes.dark || !rawPalettes.light) return null;
  const result = { version:1 as const, id:value.id as ThemeId, appearance:value.appearance as ThemeMode, palettes:{ dark:{} as ThemePalette, light:{} as ThemePalette } };
  for (const mode of ["dark","light"] as const) {
    for (const field of Object.keys(palettes.signature.light) as Array<keyof ThemePalette>) {
      const candidate = rawPalettes[mode][field];
      if (!isHex(candidate)) return null;
      result.palettes[mode][field] = candidate;
    }
  }
  return result;
}

export function readThemePreferences(): ThemePreferences | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw ? normalizeThemePreferences(JSON.parse(raw)) : null;
  } catch { return null; }
}

export function saveThemePreferences(preferences: ThemePreferences): boolean {
  try {
    const clean = normalizeThemePreferences(preferences);
    if (!clean || typeof window === "undefined") return false;
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(clean));
    return true;
  } catch { return false; }
}

export function resolveThemeMode(appearance: ThemeMode): "dark" | "light" {
  if (appearance !== "system") return appearance;
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; }
  catch { return "light"; }
}

export function getThemePalette(preferences: ThemePreferences, mode: "dark" | "light" = resolveThemeMode(preferences.appearance)): ThemePalette {
  return copyPalette(preferences.palettes[mode]);
}

const cssVariables: Array<[keyof ThemePalette,string]> = [
  ["background","--ax-theme-background"],["surface","--ax-theme-surface"],["raised","--ax-theme-raised"],
  ["panel","--ax-theme-panel"],["sidebar","--ax-theme-sidebar"],["border","--ax-theme-border"],
  ["primary","--ax-theme-primary"],["secondary","--ax-theme-secondary"],["accent","--ax-theme-accent"],
  ["text","--ax-theme-text"],["muted","--ax-theme-muted"],["active","--ax-theme-active"],
  ["buttonText","--ax-theme-button-text"],["chart","--ax-theme-chart"],["graph","--ax-theme-graph"]
];

export function applyThemePreferences(preferences: ThemePreferences, target?: HTMLElement | null): "dark" | "light" | null {
  const root = target ?? (typeof document !== "undefined" ? document.querySelector<HTMLElement>(".ax-modern-shell") : null);
  const clean = normalizeThemePreferences(preferences);
  if (!root || !clean) return null;
  const mode = resolveThemeMode(clean.appearance);
  const palette = clean.palettes[mode];
  root.setAttribute("data-ax-theme",clean.id);
  root.setAttribute("data-ax-theme-mode",mode);
  root.style.colorScheme = mode;
  for (const [field,variable] of cssVariables) root.style.setProperty(variable,palette[field]);
  return mode;
}

export function clearThemeApplication(target?: HTMLElement | null): void {
  const root = target ?? (typeof document !== "undefined" ? document.querySelector<HTMLElement>(".ax-modern-shell") : null);
  if (!root) return;
  root.removeAttribute("data-ax-theme");
  root.removeAttribute("data-ax-theme-mode");
  root.style.colorScheme = "normal";
  for (const [,variable] of cssVariables) root.style.removeProperty(variable);
}

export function clearSavedThemePreferences(): void {
  try { if (typeof window !== "undefined") window.localStorage.removeItem(THEME_STORAGE_KEY); } catch { /* local preference storage can be unavailable */ }
}
