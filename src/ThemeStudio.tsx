import { useEffect, useMemo, useState } from "react";
import { Check, Monitor, Moon, Palette, RotateCcw, Sun, X } from "lucide-react";
import {
  applyThemePreferences, clearSavedThemePreferences, clearThemeApplication,
  createThemePreferences, getThemePalette, readThemePreferences,
  resolveThemeMode, saveThemePreferences, THEME_COLOR_FIELDS, THEME_PRESETS,
  type ThemeId, type ThemeMode, type ThemePalette, type ThemePreferences
} from "./lib/theme-preferences";

const MODE_OPTIONS: Array<{ id: ThemeMode; label: string; Icon: typeof Sun }> = [
  { id:"dark",label:"Dark",Icon:Moon },
  { id:"light",label:"Light",Icon:Sun },
  { id:"system",label:"System",Icon:Monitor }
];

export default function ThemeStudio() {
  const stored = useMemo(() => readThemePreferences(), []);
  const [applied,setApplied] = useState<ThemePreferences | null>(stored);
  const [draft,setDraft] = useState<ThemePreferences>(() => stored || createThemePreferences("signature","system"));
  const [previewEnabled,setPreviewEnabled] = useState(Boolean(stored));
  const [status,setStatus] = useState("");
  const effectiveMode = resolveThemeMode(draft.appearance);
  const palette = getThemePalette(draft,effectiveMode);

  useEffect(() => {
    if (previewEnabled) applyThemePreferences(draft);
  },[draft,previewEnabled]);

  const choosePreset = (id: ThemeId) => {
    const next = createThemePreferences(id,draft.appearance,palette);
    setDraft(next);
    setPreviewEnabled(true);
    setStatus("Previewing " + (THEME_PRESETS.find(item=>item.id===id)?.name || "Custom Theme") + ".");
  };

  const changeMode = (appearance: ThemeMode) => {
    setDraft(previous=>({...previous,appearance}));
    setPreviewEnabled(true);
    setStatus("Preview updated for " + appearance + " appearance.");
  };

  const changeColour = (key: keyof ThemePalette,value: string) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) return;
    setDraft(previous=>{
      const current = getThemePalette(previous,resolveThemeMode(previous.appearance));
      return {
        ...previous,id:"custom",
        palettes:{...previous.palettes,[resolveThemeMode(previous.appearance)]:{...current,[key]:value}}
      };
    });
    setPreviewEnabled(true);
    setStatus("Custom palette preview updated.");
  };

  const apply = () => {
    if (!saveThemePreferences(draft)) {
      setStatus("Theme could not be saved on this device. Check local storage availability.");
      return;
    }
    setApplied(draft);
    setPreviewEnabled(true);
    applyThemePreferences(draft);
    setStatus("Theme applied and saved on this device.");
  };

  const cancel = () => {
    if (applied) {
      setDraft(applied);
      setPreviewEnabled(true);
      applyThemePreferences(applied);
    } else {
      clearSavedThemePreferences();
      clearThemeApplication();
      setDraft(createThemePreferences("signature","system"));
      setPreviewEnabled(false);
    }
    setStatus("Unapplied preview changes were cancelled.");
  };

  const reset = () => {
    const next = createThemePreferences("signature","system");
    setDraft(next);
    setPreviewEnabled(true);
    setStatus("AXIVESTRA Signature is ready to preview. Select Apply to save it.");
  };

  const activeName = draft.id === "custom"
    ? "Custom Theme"
    : THEME_PRESETS.find(item=>item.id===draft.id)?.name || "AXIVESTRA";
  const swatches = [palette.primary,palette.secondary,palette.accent,palette.chart,palette.graph];

  return <section className="ax-theme-studio" aria-labelledby="ax-theme-studio-title">
    <div className="ax-theme-studio__heading">
      <div><span className="ax-theme-studio__eyebrow"><Palette size={14}/> APPEARANCE CONTROL</span><h3 id="ax-theme-studio-title">Theme Studio</h3><p>Customize the AXIVESTRA workspace without changing business records or cloud data.</p></div>
      <div className="ax-theme-studio__current"><span>Current preview</span><strong>{activeName}</strong><small>{effectiveMode === "dark" ? "Dark appearance" : "Light appearance"}</small></div>
    </div>
    <div className="ax-theme-studio__mode" role="group" aria-label="Appearance mode">
      {MODE_OPTIONS.map(({id,label,Icon})=><button key={id} type="button" className={draft.appearance===id?"is-active":""} aria-pressed={draft.appearance===id} onClick={()=>changeMode(id)}><Icon size={15}/>{label}</button>)}
    </div>
    <div className="ax-theme-studio__section-head"><div><strong>Ready-made themes</strong><small>Choose a coordinated AXIVESTRA palette</small></div><span>{THEME_PRESETS.length} presets + Custom</span></div>
    <div className="ax-theme-studio__themes">
      {THEME_PRESETS.map(item=>{
        const itemPalette = item.id === "signature" ? createThemePreferences(item.id,draft.appearance).palettes[effectiveMode]
          : createThemePreferences(item.id,draft.appearance).palettes[effectiveMode];
        return <button type="button" key={item.id} className={"ax-theme-studio__theme"+(draft.id===item.id?" is-selected":"")} aria-pressed={draft.id===item.id} onClick={()=>choosePreset(item.id)}>
          <span className="ax-theme-studio__theme-swatches">{[itemPalette.primary,itemPalette.secondary,itemPalette.accent,itemPalette.surface,itemPalette.sidebar].map((colour,index)=><i key={index} style={{backgroundColor:colour}}/>)}</span>
          <strong>{item.name}</strong><small>{item.description}</small>{draft.id===item.id&&<span className="ax-theme-studio__selected"><Check size={12}/> Selected</span>}
        </button>;
      })}
      <button type="button" className={"ax-theme-studio__theme ax-theme-studio__custom"+(draft.id==="custom"?" is-selected":"")} aria-pressed={draft.id==="custom"} onClick={()=>choosePreset("custom")}>
        <span className="ax-theme-studio__theme-swatches">{swatches.map((colour,index)=><i key={index} style={{backgroundColor:colour}}/>)}</span>
        <strong>Custom Theme</strong><small>Build a personal palette with HEX values and colour pickers</small>{draft.id==="custom"&&<span className="ax-theme-studio__selected"><Check size={12}/> Selected</span>}
      </button>
    </div>
    <div className="ax-theme-studio__editor">
      <div className="ax-theme-studio__section-head"><div><strong>Palette controls</strong><small>Adjust the selected {effectiveMode} palette</small></div><span>HEX + colour picker</span></div>
      <div className="ax-theme-studio__palette">
        {THEME_COLOR_FIELDS.map(({key,label,hint})=><label className="ax-theme-studio__colour" key={key}>
          <span><strong>{label}</strong><small>{hint}</small></span>
          <span className="ax-theme-studio__colour-inputs"><input aria-label={label+" colour picker"} type="color" value={palette[key]} onChange={event=>changeColour(key,event.target.value)}/><input aria-label={label+" HEX value"} type="text" value={palette[key].toUpperCase()} maxLength={7} pattern="#[0-9A-Fa-f]{6}" onChange={event=>changeColour(key,event.target.value)} spellCheck={false}/></span>
        </label>)}
      </div>
    </div>
    <div className="ax-theme-studio__contrast-note" role="note">
      **Readability guard:** text and button foregrounds automatically switch to a high-contrast colour when the chosen pair falls below 4.5:1. Your saved HEX palette values are preserved.
    </div>
    <div className="ax-theme-studio__preview" aria-label="Theme style preview">
      <div><span>STYLE PREVIEW · SAMPLE ONLY</span><strong>Asset Intelligence</strong><small>Assets · Capital · Relationships · Not live business data</small></div>
      <div className="ax-theme-studio__preview-metrics"><span><small>Recorded exposure</small><strong>₹—</strong></span><span><small>Open actions</small><strong>—</strong></span></div>
      <div className="ax-theme-studio__preview-bars">{swatches.map((colour,index)=><i key={index} style={{backgroundColor:colour,height:(22+index*10)+"px"}}/>)}</div>
    </div>
    <div className="ax-theme-studio__footer">
      <p role="status" aria-live="polite">{status || "Changes preview instantly. Apply saves the preference locally on this device."}</p>
      <div><button type="button" className="secondary-button" onClick={cancel}><X size={14}/> Cancel</button><button type="button" className="secondary-button" onClick={reset}><RotateCcw size={14}/> Reset</button><button type="button" className="primary-button" onClick={apply}><Check size={14}/> Apply theme</button></div>
    </div>
  </section>;
}
