/// <reference types="vite/client" />
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import {
  ArrowDown, ArrowRight, ArrowUpRight, BadgeCheck, BarChart3, Building2, Check,
  ChevronDown, CircleHelp, ClipboardList, Compass, FileCheck2, Globe2, HandCoins,
  Landmark, Layers3, LockKeyhole, LogIn, Mail, Menu, Network, Phone, Send,
  ShieldCheck, Sparkles, Users, Wallet, X
} from "lucide-react";
import "./styles.css";

const APP_URL = "https://axivestra.pages.dev";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || "";
const publishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "").trim();
const db: SupabaseClient | null = supabaseUrl && publishableKey
  ? createClient(supabaseUrl, publishableKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    })
  : null;

type SiteSettings = {
  id: string;
  brand_name: string;
  tagline: string;
  hero_title: string;
  hero_subtitle: string;
  primary_cta: string;
  contact_email: string;
  contact_phone: string;
  logo_url: string;
  app_url: string;
  seo_title: string;
  seo_description: string;
};
type WebsitePage = {
  slug: string;
  title: string;
  summary: string;
  body: string;
  seo_title: string;
  seo_description: string;
  status: "draft" | "published";
  updated_at?: string;
};
type WebsiteLead = {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  message: string;
  status: "new" | "contacted" | "closed";
  created_at: string;
};

const DEFAULT_SETTINGS: SiteSettings = {
  id: "main",
  brand_name: "AXIVESTRA",
  tagline: "Asset Intelligence Platform",
  hero_title: "See the full picture behind every asset and capital decision.",
  hero_subtitle: "AXIVESTRA brings asset, deal, lending, investment, counterparty, legal and operational records into one connected workspace.",
  primary_cta: "Request a walkthrough",
  contact_email: "",
  contact_phone: "",
  logo_url: "",
  app_url: APP_URL,
  seo_title: "AXIVESTRA — Asset Intelligence Platform",
  seo_description: "Connect asset, capital and relationship workflows in one structured intelligence workspace."
};

const FEATURE_CARDS = [
  { icon: Building2, title: "Assets & property", text: "Organise property records, transactions, locations, ownership details and supporting documents." },
  { icon: HandCoins, title: "Credit & lending", text: "Keep facilities, borrower and lender details, terms, repayments and outstanding exposure connected." },
  { icon: BarChart3, title: "Ventures & equity", text: "Track startup opportunities, equity positions, milestones and investment information." },
  { icon: Layers3, title: "Funds & portfolios", text: "Bring funds, investors, commitments, capital calls and portfolio positions into view." },
  { icon: FileCheck2, title: "Legal & compliance", text: "Organise matters, evidence, deadlines, KYC records, approvals and risk follow-ups." },
  { icon: Network, title: "Relationship intelligence", text: "Connect people, organisations, assets, deals and money movements using traceable record links." }
];

function Logo({ settings, compact = false }: { settings: SiteSettings; compact?: boolean }) {
  return (
    <a className={"brand" + (compact ? " brand-compact" : "")} href="/" aria-label={settings.brand_name + " home"}>
      {settings.logo_url
        ? <img className="brand-image" src={settings.logo_url} alt="" />
        : <span className="brand-mark"><span /></span>}
      <span className="brand-copy"><strong>{settings.brand_name}</strong><small>{settings.tagline}</small></span>
    </a>
  );
}

function Site({ path, navigate }: { path: string; navigate: (path: string) => void }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [pages, setPages] = useState<WebsitePage[]>([]);
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => {
    if (!db) return;
    let active = true;
    void Promise.all([
      db.from("website_settings").select("*").eq("id", "main").maybeSingle(),
      db.from("website_pages").select("*").eq("status", "published").order("title")
    ]).then(([settingsResult, pagesResult]) => {
      if (!active) return;
      if (settingsResult.data) setSettings({ ...DEFAULT_SETTINGS, ...settingsResult.data });
      if (pagesResult.data) setPages(pagesResult.data as WebsitePage[]);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    document.title = settings.seo_title || settings.brand_name;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute("content", settings.seo_description || settings.hero_subtitle);
  }, [settings]);

  const slug = path.startsWith("/pages/") ? decodeURIComponent(path.slice(7)) : "";
  const customPage = pages.find(page => page.slug === slug);
  const goSection = (id: string) => {
    setMobileMenu(false);
    if (path !== "/") navigate("/");
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }), 30);
  };
  const customLinks = pages.filter(page => !["home", "about", "platform", "solutions", "contact"].includes(page.slug));
  const appLink = settings.app_url || APP_URL;

  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="nav-wrap">
          <Logo settings={settings} />
          <nav className={"main-nav" + (mobileMenu ? " nav-open" : "")} aria-label="Main navigation">
            <button onClick={() => goSection("platform")}>Platform</button>
            <button onClick={() => goSection("solutions")}>Solutions</button>
            <button onClick={() => goSection("about")}>About</button>
            {customLinks.map(page => <button key={page.slug} onClick={() => { setMobileMenu(false); navigate("/pages/" + page.slug); }}>{page.title}</button>)}
            <button className="mobile-contact" onClick={() => goSection("contact")}>Contact</button>
          </nav>
          <div className="nav-actions">
            <a className="nav-login" href={appLink}><LogIn size={16}/> Sign in</a>
            <button className="button button-primary nav-cta" onClick={() => goSection("contact")}>Talk to us <ArrowUpRight size={16}/></button>
            <button className="mobile-menu" aria-label={mobileMenu ? "Close menu" : "Open menu"} onClick={() => setMobileMenu(v => !v)}>
              {mobileMenu ? <X size={22}/> : <Menu size={22}/>}
            </button>
          </div>
        </div>
      </header>

      {customPage ? (
        <main className="custom-page">
          <div className="section-container narrow">
            <p className="eyebrow"><span/> AXIVESTRA / {customPage.slug.toUpperCase()}</p>
            <h1>{customPage.title}</h1>
            {customPage.summary && <p className="page-summary">{customPage.summary}</p>}
            <div className="custom-page-body">{customPage.body.split(/\n{2,}/).map((paragraph, i) => <p key={i}>{paragraph}</p>)}</div>
            <button className="button button-primary" onClick={() => navigate("/")}>Back to website <ArrowRight size={16}/></button>
          </div>
        </main>
      ) : (
        <main>
          <section className="hero-section">
            <div className="hero-grid">
              <div className="hero-copy">
                <p className="eyebrow"><span/> {settings.tagline}</p>
                <h1>{settings.hero_title}</h1>
                <p className="hero-lead">{settings.hero_subtitle}</p>
                <div className="hero-actions">
                  <button className="button button-primary button-large" onClick={() => goSection("contact")}>{settings.primary_cta} <ArrowUpRight size={17}/></button>
                  <button className="button button-ghost button-large" onClick={() => goSection("platform")}>Explore the platform <ArrowDown size={17}/></button>
                </div>
                <div className="hero-note"><ShieldCheck size={16}/> Structured records. Traceable relationships. Human-led decisions.</div>
              </div>
              <div className="hero-visual" aria-label="Abstract connected asset intelligence illustration">
                <div className="visual-orbit orbit-one"/><div className="visual-orbit orbit-two"/>
                <div className="visual-glow"/>
                <div className="visual-core"><span className="core-symbol"><Layers3 size={34}/></span><strong>AXIVESTRA</strong><small>ASSET INTELLIGENCE</small></div>
                <div className="visual-node node-top"><Building2 size={18}/><span>Assets</span></div>
                <div className="visual-node node-right"><Wallet size={18}/><span>Capital</span></div>
                <div className="visual-node node-bottom"><Users size={18}/><span>People</span></div>
                <div className="visual-node node-left"><FileCheck2 size={18}/><span>Evidence</span></div>
                <div className="visual-dot dot-one"/><div className="visual-dot dot-two"/><div className="visual-dot dot-three"/>
                <div className="visual-caption"><span className="live-dot"/> CONNECTED WORKFLOWS <span className="caption-line"/></div>
              </div>
            </div>
            <div className="hero-bottom">
              <span>ONE CONNECTED OPERATING WORKSPACE</span><span className="hero-bottom-line"/><span>BUILT FOR CLARITY AND CONTROL</span>
            </div>
          </section>

          <section className="trust-strip">
            <div className="trust-item"><BadgeCheck size={18}/><span>Connected domain workspaces</span></div>
            <div className="trust-item"><Network size={18}/><span>Relationship-led records</span></div>
            <div className="trust-item"><ShieldCheck size={18}/><span>Evidence-aware decisions</span></div>
            <div className="trust-item"><ClipboardList size={18}/><span>Auditable follow-through</span></div>
          </section>

          <section className="section-block" id="platform">
            <div className="section-container">
              <div className="section-heading">
                <div><p className="eyebrow"><span/> THE PLATFORM</p><h2>More than a register.<br/><em>A connected view of your work.</em></h2></div>
                <p className="section-intro">AXIVESTRA is designed to connect the records behind assets, capital, counterparties and obligations, so teams can understand what exists, what is related and what needs attention.</p>
              </div>
              <div className="feature-grid">
                {FEATURE_CARDS.map(({ icon: Icon, title, text }, index) => (
                  <article className="feature-card" key={title}>
                    <div className="feature-top"><span className="feature-icon"><Icon size={22}/></span><span className="feature-number">0{index + 1}</span></div>
                    <h3>{title}</h3><p>{text}</p><span className="feature-arrow"><ArrowUpRight size={18}/></span>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="workflow-section" id="solutions">
            <div className="section-container workflow-layout">
              <div className="workflow-copy">
                <p className="eyebrow"><span/> FROM RECORDS TO ACTION</p>
                <h2>Connect the context.<br/><em>Then decide what comes next.</em></h2>
                <p>Bring together the records, people, documents, money movements and obligations that explain a deal or an asset. AXIVESTRA helps teams organise the evidence and coordinate the next action without presenting assumptions as verified facts.</p>
                <ul className="check-list">
                  <li><Check size={17}/> One place for connected records and supporting documents</li>
                  <li><Check size={17}/> Clear ownership, roles, tasks and follow-ups</li>
                  <li><Check size={17}/> Record-derived views with traceable inputs</li>
                  <li><Check size={17}/> Human review for consequential decisions</li>
                </ul>
                <button className="button button-primary" onClick={() => goSection("contact")}>Discuss your workflow <ArrowRight size={16}/></button>
              </div>
              <div className="workflow-visual">
                <div className="flow-label">CONNECTED RECORDS</div>
                <div className="flow-row"><span className="flow-icon flow-blue"><Building2 size={18}/></span><div><strong>Asset or opportunity</strong><small>Property · Deal · Investment</small></div><span className="flow-tag">RECORD</span></div>
                <div className="flow-connector"><span/></div>
                <div className="flow-row"><span className="flow-icon flow-purple"><Users size={18}/></span><div><strong>People and organisations</strong><small>Roles · Relationships · Counterparties</small></div><span className="flow-tag">LINK</span></div>
                <div className="flow-connector"><span/></div>
                <div className="flow-row"><span className="flow-icon flow-gold"><FileCheck2 size={18}/></span><div><strong>Evidence and money movement</strong><small>Documents · Transactions · Terms</small></div><span className="flow-tag">VERIFY</span></div>
                <div className="flow-connector"><span/></div>
                <div className="flow-row flow-result"><span className="flow-icon flow-green"><Compass size={18}/></span><div><strong>Next action and decision</strong><small>Owner · Due date · Review trail</small></div><span className="flow-tag">ACT</span></div>
                <div className="flow-foot"><Sparkles size={15}/> Explainable context, not a black-box answer.</div>
              </div>
            </div>
          </section>

          <section className="about-section" id="about">
            <div className="section-container about-layout">
              <div className="about-stamp"><span>AX</span><small>ASSET<br/>INTELLIGENCE</small></div>
              <div className="about-copy"><p className="eyebrow"><span/> WHY AXIVESTRA</p><h2>Better visibility starts<br/>with <em>better connections.</em></h2><p>Important decisions rarely sit inside one spreadsheet or one department. Asset details, financing, investor relationships, legal matters, documents and commitments often live in separate places. AXIVESTRA is built to bring that context together while keeping data provenance, permissions and human accountability visible.</p><button className="text-link" onClick={() => goSection("contact")}>Start a conversation <ArrowUpRight size={17}/></button></div>
              <div className="about-points"><div><strong>01</strong><span>Capture</span><p>Keep important records organised and accessible.</p></div><div><strong>02</strong><span>Connect</span><p>Link entities through explicit relationships and roles.</p></div><div><strong>03</strong><span>Act</span><p>Turn deadlines, gaps and decisions into owned next steps.</p></div></div>
            </div>
          </section>

          <section className="contact-section" id="contact">
            <div className="section-container contact-layout">
              <div className="contact-copy"><p className="eyebrow"><span/> LET'S TALK</p><h2>Bring your work<br/><em>into clearer view.</em></h2><p>Tell us what you are trying to organise or connect. The AXIVESTRA team can follow up about a suitable walkthrough.</p>
                <div className="contact-details">
                  {settings.contact_email && <a href={"mailto:" + settings.contact_email}><Mail size={17}/>{settings.contact_email}</a>}
                  {settings.contact_phone && <a href={"tel:" + settings.contact_phone.replace(/[^\d+]/g, "")}><Phone size={17}/>{settings.contact_phone}</a>}
                </div>
              </div>
              <ContactForm client={db}/>
            </div>
          </section>
          <section className="disclaimer-strip"><ShieldCheck size={17}/><p>Website information describes AXIVESTRA's intended workflows. Data displayed inside a workspace is based on records entered or connected there; external market, investor, court, valuation and screening sources are not implied unless separately configured and verified.</p></section>
        </main>
      )}

      <footer className="site-footer">
        <div className="footer-top"><Logo settings={settings}/><div className="footer-actions"><a href={appLink}>Open AXIVESTRA workspace <ArrowUpRight size={15}/></a><button onClick={() => navigate("/admin")}><LockKeyhole size={14}/> Website admin</button></div></div>
        <div className="footer-bottom"><span>© {new Date().getFullYear()} {settings.brand_name}. All rights reserved.</span><span>Asset · Capital · Relationships</span><span className="footer-powered"><Globe2 size={13}/> Built for connected work</span></div>
      </footer>
    </div>
  );
}

function ContactForm({ client }: { client: SupabaseClient | null }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", message: "", website: "" });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [sent, setSent] = useState(false);
  const update = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    if (form.website.trim()) { setSent(true); return; }
    if (!client) { setNotice("The contact form is not connected yet. Please use the contact details shown on this page."); return; }
    if (!consent) { setNotice("Please confirm that AXIVESTRA may contact you about this enquiry."); return; }
    setBusy(true);
    const { error } = await client.from("website_leads").insert({
      name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(),
      company: form.company.trim(), message: form.message.trim(), consent: true,
      source_url: window.location.href
    });
    setBusy(false);
    if (error) { setNotice("Your enquiry could not be sent. Please try again or use the contact details shown on this page."); return; }
    setSent(true);
  }

  if (sent) return <div className="contact-success"><span><Check size={24}/></span><h3>Thank you for reaching out.</h3><p>Your enquiry has been recorded. The team can follow up using the details you provided.</p><button className="text-link" onClick={() => { setSent(false); setForm({ name: "", email: "", phone: "", company: "", message: "", website: "" }); setConsent(false); }}>Send another enquiry</button></div>;

  return (
    <form className="contact-form" onSubmit={submit}>
      <div className="form-heading"><span>ENQUIRY FORM</span><small>Fields marked * are required</small></div>
      <label>Your name *<input required maxLength={120} value={form.name} onChange={e => update("name", e.target.value)} placeholder="Name"/></label>
      <div className="form-two"><label>Email address *<input type="email" required maxLength={254} value={form.email} onChange={e => update("email", e.target.value)} placeholder="you@company.com"/></label><label>Phone<input type="tel" maxLength={40} value={form.phone} onChange={e => update("phone", e.target.value)} placeholder="+91"/></label></div>
      <label>Company<input maxLength={160} value={form.company} onChange={e => update("company", e.target.value)} placeholder="Company or organisation"/></label>
      <label>What would you like to discuss? *<textarea required rows={4} maxLength={4000} value={form.message} onChange={e => update("message", e.target.value)} placeholder="Tell us briefly about your requirements."/></label>
      <label className="consent-row"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/><span>I agree to be contacted about this enquiry.</span></label>
      <label className="honeypot" aria-hidden="true">Leave this field empty<input tabIndex={-1} autoComplete="off" value={form.website} onChange={e => update("website", e.target.value)}/></label>
      {notice && <p className="form-notice" role="alert">{notice}</p>}
      <button className="button button-primary button-large form-submit" disabled={busy}>{busy ? "Sending…" : "Send enquiry"} <Send size={16}/></button>
      <small className="form-privacy">Please do not submit confidential financial, legal or identity documents through this public form.</small>
    </form>
  );
}

const EMPTY_PAGE: WebsitePage = { slug: "", title: "", summary: "", body: "", seo_title: "", seo_description: "", status: "draft" };

function AdminScreen({ navigate }: { navigate: (path: string) => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">("checking");
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"overview" | "content" | "pages" | "leads" | "domain">("overview");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [pages, setPages] = useState<WebsitePage[]>([]);
  const [leads, setLeads] = useState<WebsiteLead[]>([]);
  const [pageDraft, setPageDraft] = useState<WebsitePage>(EMPTY_PAGE);
  const [editingSlug, setEditingSlug] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    if (!db) return;
    void db.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = db.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!db || !session?.user.id) { setAccess("checking"); return; }
    let active = true;
    setAccess("checking");
    void (async () => {
      const { data, error: accessError } = await db.from("website_admins").select("role").eq("user_id", session.user.id).maybeSingle();
      if (!active) return;
      if (accessError || !data) {
        setAccess("denied");
        setError(accessError ? accessError.message : "This account is not yet authorised to manage the AXIVESTRA website.");
        return;
      }
      setRole(String(data.role));
      setAccess("allowed");
      const [settingsResult, pagesResult, leadsResult] = await Promise.all([
        db.from("website_settings").select("*").eq("id", "main").maybeSingle(),
        db.from("website_pages").select("*").order("title"),
        db.from("website_leads").select("*").order("created_at", { ascending: false }).limit(200)
      ]);
      if (!active) return;
      if (settingsResult.data) setSettings({ ...DEFAULT_SETTINGS, ...settingsResult.data });
      if (pagesResult.data) setPages(pagesResult.data as WebsitePage[]);
      if (leadsResult.data) setLeads(leadsResult.data as WebsiteLead[]);
      const loadError = settingsResult.error || pagesResult.error || leadsResult.error;
      if (loadError) setError("Some admin records could not be loaded: " + loadError.message);
    })();
    return () => { active = false; };
  }, [session?.user.id]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!db) return;
    setBusy(true); setError("");
    const { error: authError } = await db.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (authError) setError(authError.message);
  }
  async function signOut() {
    if (db) await db.auth.signOut();
    setSession(null); setAccess("checking"); setRole("");
  }
  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!db) return;
    setBusy(true); setError(""); setSaved("");
    const { error: saveError } = await db.from("website_settings").upsert({ ...settings, id: "main", updated_at: new Date().toISOString() }, { onConflict: "id" });
    setBusy(false);
    if (saveError) setError(saveError.message); else setSaved("Website settings saved.");
  }
  function editPage(page: WebsitePage) { setPageDraft({ ...page }); setEditingSlug(page.slug); setSaved(""); }
  function newPage() { setPageDraft(EMPTY_PAGE); setEditingSlug(""); setSaved(""); }
  async function savePage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!db) return;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pageDraft.slug)) { setError("Use a page URL slug containing lowercase letters, numbers and hyphens."); return; }
    setBusy(true); setError(""); setSaved("");
    const payload = { ...pageDraft, updated_at: new Date().toISOString(), updated_by: session?.user.id };
    const result = editingSlug && editingSlug !== pageDraft.slug
      ? await db.from("website_pages").update(payload).eq("slug", editingSlug)
      : await db.from("website_pages").upsert(payload, { onConflict: "slug" });
    setBusy(false);
    if (result.error) { setError(result.error.message); return; }
    setPages(current => {
      const withoutOld = current.filter(page => page.slug !== editingSlug && page.slug !== pageDraft.slug);
      return [...withoutOld, payload].sort((a, b) => a.title.localeCompare(b.title));
    });
    setEditingSlug(pageDraft.slug); setSaved("Page saved.");
  }
  async function deletePage(slug: string) {
    if (!db || !window.confirm("Delete the website page '" + slug + "'?")) return;
    const { error: deleteError } = await db.from("website_pages").delete().eq("slug", slug);
    if (deleteError) setError(deleteError.message);
    else { setPages(current => current.filter(page => page.slug !== slug)); newPage(); setSaved("Page deleted."); }
  }
  async function updateLeadStatus(id: string, status: WebsiteLead["status"]) {
    if (!db) return;
    const { error: updateError } = await db.from("website_leads").update({ status }).eq("id", id);
    if (updateError) setError(updateError.message);
    else setLeads(current => current.map(lead => lead.id === id ? { ...lead, status } : lead));
  }
  const newLeads = leads.filter(lead => lead.status === "new").length;

  if (!db) return <AdminFrame navigate={navigate}><div className="admin-message"><LockKeyhole size={28}/><h1>Website admin setup required</h1><p>Set the public Supabase URL and publishable key in the Cloudflare Pages environment, then run the website database migration. No passwords or service-role keys belong in website code.</p><button className="button button-primary" onClick={() => navigate("/")}>Return to website</button></div></AdminFrame>;

  if (!session) return (
    <AdminFrame navigate={navigate}>
      <div className="admin-login-card">
        <div className="admin-lock"><LockKeyhole size={24}/></div><p className="eyebrow"><span/> SECURE WEBSITE ACCESS</p><h1>Website administration</h1><p>Sign in with your AXIVESTRA website administrator account.</p>
        <form onSubmit={signIn}><label>Email address<input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="username"/></label><label>Password<input type="password" required value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password"/></label>{error && <p className="admin-error" role="alert">{error}</p>}<button className="button button-primary button-large" disabled={busy}>{busy ? "Signing in…" : "Sign in"} <ArrowRight size={16}/></button></form>
        <button className="admin-back-link" onClick={() => navigate("/")}>Return to public website</button>
      </div>
    </AdminFrame>
  );

  if (access === "checking") return <AdminFrame navigate={navigate}><div className="admin-message"><div className="spinner"/><h1>Checking administrator access</h1><p>Verifying your account permissions…</p></div></AdminFrame>;
  if (access === "denied") return <AdminFrame navigate={navigate}><div className="admin-message"><LockKeyhole size={28}/><h1>Administrator access not enabled</h1><p>{error || "This account has not been added to the website administrator list."}</p><p>Ask the project owner to provision your user in the website_admins table. Signing in alone does not grant administrator permissions.</p><button className="button button-primary" onClick={() => void signOut()}>Sign out</button></div></AdminFrame>;

  const setSetting = (key: keyof SiteSettings, value: string) => setSettings(current => ({ ...current, [key]: value }));

  return (
    <AdminFrame navigate={navigate}>
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <div className="admin-brand"><span className="brand-mark"><span/></span><div><strong>AXIVESTRA</strong><small>WEBSITE CONTROL</small></div></div>
          <div className="admin-nav-label">MANAGE WEBSITE</div>
          {([
            ["overview", "Overview", Compass],
            ["content", "Site content", Layers3],
            ["pages", "Pages", FileCheck2],
            ["leads", "Enquiries", Mail],
            ["domain", "Domain & launch", Globe2]
          ] as const).map(([key, label, Icon]) => <button key={key} className={"admin-nav-item" + (tab === key ? " active" : "")} onClick={() => setTab(key)}><Icon size={17}/>{label}{key === "leads" && newLeads > 0 && <b>{newLeads}</b>}</button>)}
          <div className="admin-sidebar-bottom"><span className="admin-role"><ShieldCheck size={15}/> {role}</span><span className="admin-user-email">{session.user.email}</span><button onClick={() => void signOut()}><LogIn size={15}/> Sign out</button></div>
        </aside>
        <section className="admin-main">
          <div className="admin-topbar"><div><small>AXIVESTRA / WEBSITE</small><h1>{({ overview: "Overview", content: "Site content", pages: "Pages", leads: "Enquiries", domain: "Domain & launch" } as const)[tab]}</h1></div><a className="admin-preview-link" href="/" target="_blank" rel="noreferrer">View public website <ArrowUpRight size={15}/></a></div>
          {error && <div className="admin-error-banner" role="alert">{error}<button onClick={() => setError("")}><X size={15}/></button></div>}
          {saved && <div className="admin-saved-banner" role="status"><Check size={15}/>{saved}<button onClick={() => setSaved("")}><X size={15}/></button></div>}

          {tab === "overview" && <div className="admin-dashboard-grid">
            <div className="admin-stat-card"><span>Published pages</span><strong>{pages.filter(page => page.status === "published").length}</strong><small>Visible on the public website</small></div>
            <div className="admin-stat-card"><span>Total enquiries</span><strong>{leads.length}</strong><small>Submissions stored in Supabase</small></div>
            <div className="admin-stat-card"><span>New enquiries</span><strong>{newLeads}</strong><small>Awaiting review</small></div>
            <div className="admin-welcome"><p className="eyebrow"><span/> ADMINISTRATOR WORKSPACE</p><h2>Your website, under your control.</h2><p>Update the homepage, publish additional pages, review enquiries and prepare your domain. Public changes are saved to the website database; nothing changes the AXIVESTRA business records.</p><div className="admin-quick-actions"><button onClick={() => setTab("content")}>Edit homepage <ArrowRight size={15}/></button><button onClick={() => { newPage(); setTab("pages"); }}>Add a page <ArrowRight size={15}/></button></div></div>
          </div>}

          {tab === "content" && <form className="admin-form-card" onSubmit={saveSettings}>
            <div className="admin-card-heading"><div><h2>Brand and homepage</h2><p>These fields control the public website header, hero section and contact details.</p></div><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button></div>
            <div className="admin-form-grid">
              <label>Website / brand name<input maxLength={100} value={settings.brand_name} onChange={e => setSetting("brand_name", e.target.value)}/></label>
              <label>Tagline<input maxLength={160} value={settings.tagline} onChange={e => setSetting("tagline", e.target.value)}/></label>
              <label className="wide-field">Homepage headline<input maxLength={220} value={settings.hero_title} onChange={e => setSetting("hero_title", e.target.value)}/></label>
              <label className="wide-field">Homepage introduction<textarea rows={3} maxLength={1200} value={settings.hero_subtitle} onChange={e => setSetting("hero_subtitle", e.target.value)}/></label>
              <label>Primary button label<input maxLength={80} value={settings.primary_cta} onChange={e => setSetting("primary_cta", e.target.value)}/></label>
              <label>App / sign-in URL<input type="url" value={settings.app_url} onChange={e => setSetting("app_url", e.target.value)}/></label>
              <label>Public contact email<input type="email" maxLength={254} value={settings.contact_email} onChange={e => setSetting("contact_email", e.target.value)}/></label>
              <label>Public contact phone<input maxLength={40} value={settings.contact_phone} onChange={e => setSetting("contact_phone", e.target.value)}/></label>
              <label className="wide-field">Logo image URL<input type="url" value={settings.logo_url} onChange={e => setSetting("logo_url", e.target.value)} placeholder="https://… (optional)"/></label>
              <label className="wide-field">SEO title<input maxLength={180} value={settings.seo_title} onChange={e => setSetting("seo_title", e.target.value)}/></label>
              <label className="wide-field">SEO description<textarea rows={2} maxLength={320} value={settings.seo_description} onChange={e => setSetting("seo_description", e.target.value)}/></label>
            </div>
          </form>}

          {tab === "pages" && <div className="admin-pages-layout">
            <div className="admin-form-card page-editor">
              <div className="admin-card-heading"><div><h2>{editingSlug ? "Edit page" : "Create a page"}</h2><p>Draft pages stay private until published.</p></div><button type="button" className="button button-outline" onClick={newPage}>New page <X size={14}/></button></div>
              <form onSubmit={savePage} className="admin-form-grid">
                <label>Page URL slug<input required maxLength={80} value={pageDraft.slug} onChange={e => setPageDraft(current => ({ ...current, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") }))} placeholder="for-example-services"/></label>
                <label>Page status<select value={pageDraft.status} onChange={e => setPageDraft(current => ({ ...current, status: e.target.value as WebsitePage["status"] }))}><option value="draft">Draft</option><option value="published">Published</option></select></label>
                <label className="wide-field">Page title<input required maxLength={160} value={pageDraft.title} onChange={e => setPageDraft(current => ({ ...current, title: e.target.value }))}/></label>
                <label className="wide-field">Short introduction<textarea rows={2} maxLength={500} value={pageDraft.summary} onChange={e => setPageDraft(current => ({ ...current, summary: e.target.value }))}/></label>
                <label className="wide-field">Page content<textarea rows={10} maxLength={15000} value={pageDraft.body} onChange={e => setPageDraft(current => ({ ...current, body: e.target.value }))} placeholder="Write paragraphs. Separate paragraphs with a blank line."/></label>
                <label className="wide-field">SEO title<input maxLength={180} value={pageDraft.seo_title} onChange={e => setPageDraft(current => ({ ...current, seo_title: e.target.value }))}/></label>
                <label className="wide-field">SEO description<textarea rows={2} maxLength={320} value={pageDraft.seo_description} onChange={e => setPageDraft(current => ({ ...current, seo_description: e.target.value }))}/></label>
                <div className="wide-field editor-actions"><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save page"}</button>{editingSlug && <button type="button" className="button button-danger" onClick={() => void deletePage(editingSlug)}>Delete page</button>}</div>
              </form>
            </div>
            <div className="admin-form-card page-list-card"><h2>Website pages</h2>{pages.length === 0 ? <p className="admin-muted">No additional pages yet. Create your first page here.</p> : pages.map(page => <button className="page-list-row" key={page.slug} onClick={() => editPage(page)}><span><strong>{page.title || page.slug}</strong><small>/pages/{page.slug}</small></span><i className={"status-pill " + page.status}>{page.status}</i></button>)}</div>
          </div>}

          {tab === "leads" && <div className="admin-form-card">
            <div className="admin-card-heading"><div><h2>Website enquiries</h2><p>Only authorised website admins can read these submissions.</p></div><span className="admin-count">{leads.length} records</span></div>
            {leads.length === 0 ? <div className="empty-admin"><Mail size={26}/><strong>No enquiries yet</strong><span>New public contact form submissions will appear here.</span></div> : <div className="lead-list">{leads.map(lead => <article className="lead-card" key={lead.id}><div className="lead-card-top"><div><strong>{lead.name}</strong><small>{lead.email}{lead.company ? " · " + lead.company : ""}</small></div><select aria-label={"Status for " + lead.name} value={lead.status} onChange={e => void updateLeadStatus(lead.id, e.target.value as WebsiteLead["status"])}><option value="new">New</option><option value="contacted">Contacted</option><option value="closed">Closed</option></select></div>{lead.phone && <p className="lead-phone">{lead.phone}</p>}<p>{lead.message}</p><small className="lead-date">{new Date(lead.created_at).toLocaleString()}</small></article>)}</div>}
          </div>}

          {tab === "domain" && <div className="admin-form-card domain-panel">
            <div className="admin-card-heading"><div><h2>Domain and launch settings</h2><p>Use Cloudflare Pages for the free website address and HTTPS.</p></div><Globe2 size={24}/></div>
            <div className="domain-current"><small>THIS WEBSITE'S CURRENT HOST</small><strong>{window.location.host}</strong><span>After the first Cloudflare Pages deployment, this will be a project-specific pages.dev subdomain.</span></div>
            <h3>Launch checklist</h3>
            <ol className="launch-list"><li><span>1</span><div><strong>Create a separate Cloudflare Pages project</strong><p>Connect the AXIVESTRA GitHub repository and select the <code>feature/axivestra-public-website</code> branch for preview, or the approved branch after review.</p></div></li><li><span>2</span><div><strong>Set the website folder as the project root</strong><p>Root directory: <code>website</code>. Build command: <code>npm run build</code>. Output directory: <code>dist</code>.</p></div></li><li><span>3</span><div><strong>Set the public Supabase environment variables</strong><p>Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>. Never add a service-role key to a browser build.</p></div></li><li><span>4</span><div><strong>Apply the website SQL migration and provision an admin</strong><p>Follow <code>website/README.md</code>. Sign in using an existing AXIVESTRA Supabase account, then grant the website_admins role in Supabase SQL Editor.</p></div></li><li><span>5</span><div><strong>Connect a custom domain later, if purchased</strong><p>A .com domain is not included in free hosting. The pages.dev address can be used without buying one.</p></div></li></ol>
            <a className="button button-primary" href="https://dash.cloudflare.com/" target="_blank" rel="noreferrer">Open Cloudflare dashboard <ArrowUpRight size={16}/></a>
          </div>}
        </section>
      </div>
    </AdminFrame>
  );
}

function AdminFrame({ children, navigate }: { children: ReactNode; navigate: (path: string) => void }) {
  return <div className="admin-shell"><header className="admin-public-bar"><button onClick={() => navigate("/")}><span className="brand-mark"><span/></span><strong>AXIVESTRA</strong><small>PUBLIC WEBSITE ADMIN</small></button><a href="/" onClick={e => { e.preventDefault(); navigate("/"); }}>View website <ArrowUpRight size={15}/></a></header>{children}</div>;
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname || "/");
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname || "/");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = (next: string) => {
    window.history.pushState({}, "", next);
    setPath(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  if (path === "/admin" || path.startsWith("/admin/")) return <AdminScreen navigate={navigate}/>;
  return <Site path={path} navigate={navigate}/>;
}
