import { useState } from "react";
import {
  Activity, ArrowRight, BarChart3, Building2, BriefcaseBusiness, Calculator,
  FileCheck2, HandCoins, Handshake, House, Landmark, Menu, Network, PieChart,
  Rocket, Scale, ShieldCheck, Store, Users, Wheat, Workflow, X
} from "lucide-react";
import "./PublicEntry.css";

type PublicEntryProps = {
  onSignIn: () => void;
  onContinueLocally: () => void;
  signInEnabled: boolean;
};

const workspaceGroups = [
  {
    name: "Real assets & transactions",
    description: "Asset records, transactions, location, ownership and due diligence.",
    icon: Building2,
    workspaces: ["Property Sale", "Agricultural Land", "Commercial Land", "House Purchase"]
  },
  {
    name: "Development & settlement",
    description: "Landowner/developer arrangements, allocations and settlement workflows.",
    icon: Handshake,
    workspaces: ["JV / JDA / JD", "SR Rate Settlement"]
  },
  {
    name: "Credit & lending",
    description: "Borrowers, lenders, facilities, collateral, repayment and exposure.",
    icon: HandCoins,
    workspaces: ["Property Loans", "Unsecured Company Loan", "Personal Loan", "Housing Loan"]
  },
  {
    name: "Ventures & securities",
    description: "Startup opportunities, equity positions, instruments and milestones.",
    icon: Rocket,
    workspaces: ["Startup", "Equity"]
  },
  {
    name: "Funds & investor services",
    description: "Portfolios, commitments, investors, capital calls and reporting.",
    icon: PieChart,
    workspaces: ["Fund & Portfolio Management", "Investor Relations"]
  },
  {
    name: "Legal & governance",
    description: "Legal matters, counterparties, compliance, evidence and review dates.",
    icon: Scale,
    workspaces: ["Litigation", "Compliance & KYC"]
  }
];

const intelligenceLayers = [
  {
    icon: Network,
    title: "Relationship intelligence",
    description: "Connect people, organisations, assets, deals, facilities, investments and matters through explicit record relationships."
  },
  {
    icon: BarChart3,
    title: "Asset & capital intelligence",
    description: "Review recorded values, exposure, commitments, repayments, portfolio concentration and the evidence behind each figure."
  },
  {
    icon: ShieldCheck,
    title: "Risk & decision intelligence",
    description: "Bring deadlines, due diligence, risks, approvals, missing information and next actions into view."
  },
  {
    icon: Workflow,
    title: "Execution & operations",
    description: "Coordinate follow-ups, tasks, documents, financial movements and auditable decisions across workspaces."
  }
];

export default function PublicEntry({ onSignIn, onContinueLocally, signInEnabled }: PublicEntryProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const goTo = (id: string) => {
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="ax-public">
      <header className="ax-public-header">
        <a className="ax-public-brand" href="#home" onClick={event => { event.preventDefault(); goTo("home"); }}>
          <img src="./axivestra-mark.svg" alt="" />
          <span><strong>AXIVESTRA</strong><small>ASSET INTELLIGENCE PLATFORM</small></span>
        </a>
        <button className="ax-public-menu-toggle" type="button" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>
          {menuOpen ? <X size={20}/> : <Menu size={20}/>}
        </button>
        <nav className={menuOpen ? "ax-public-nav is-open" : "ax-public-nav"} aria-label="Public website navigation">
          <button type="button" onClick={() => goTo("platform")}>Platform</button>
          <button type="button" onClick={() => goTo("intelligence")}>Intelligence</button>
          <button type="button" onClick={() => goTo("workspaces")}>Workspaces</button>
          <button type="button" onClick={() => goTo("operations")}>Operations</button>
          {signInEnabled && <button type="button" className="ax-public-nav-login" onClick={() => { setMenuOpen(false); onSignIn(); }}>Sign in <ArrowRight size={15}/></button>}
        </nav>
      </header>

      <main>
        <section className="ax-public-hero" id="home">
          <div className="ax-public-hero-copy">
            <div className="ax-public-eyebrow"><span/> MULTI-ASSET · CAPITAL · RELATIONSHIP INTELLIGENCE</div>
            <h1>See the full picture behind <em>every asset and decision.</em></h1>
            <p className="ax-public-lead">AXIVESTRA connects the records, relationships and workflows behind assets, capital, counterparties and obligations in one operating intelligence platform.</p>
            <div className="ax-public-actions">
              {signInEnabled && <button type="button" className="ax-public-primary" onClick={onSignIn}>Sign in to AXIVESTRA <ArrowRight size={17}/></button>}
              <button type="button" className="ax-public-secondary" onClick={onContinueLocally}><Activity size={16}/> Continue locally on this device</button>
            </div>
            <div className="ax-public-assurance"><ShieldCheck size={15}/> Your workspace opens in the same AXIVESTRA application after access is granted.</div>
          </div>
          <div className="ax-public-hero-art" aria-label="AXIVESTRA connected intelligence illustration">
            <div className="ax-public-art-orbit ax-public-art-orbit-one"/>
            <div className="ax-public-art-orbit ax-public-art-orbit-two"/>
            <div className="ax-public-art-core">
              <img src="./axivestra-mark.svg" alt=""/>
              <strong>AXIVESTRA</strong>
              <span>ASSET INTELLIGENCE</span>
            </div>
            <div className="ax-public-art-node ax-public-art-node-one"><Building2 size={17}/><span>ASSETS</span></div>
            <div className="ax-public-art-node ax-public-art-node-two"><Landmark size={17}/><span>CAPITAL</span></div>
            <div className="ax-public-art-node ax-public-art-node-three"><Users size={17}/><span>PEOPLE</span></div>
            <div className="ax-public-art-node ax-public-art-node-four"><FileCheck2 size={17}/><span>EVIDENCE</span></div>
            <div className="ax-public-art-signal"/>
          </div>
        </section>

        <section className="ax-public-proofline" aria-label="Platform principles">
          <div><span>01</span> CONNECTED SYSTEM OF RECORD</div>
          <div><span>02</span> EXPLAINABLE INTELLIGENCE</div>
          <div><span>03</span> CONTROLLED EXECUTION</div>
        </section>

        <section className="ax-public-section" id="platform">
          <div className="ax-public-section-heading">
            <div><div className="ax-public-eyebrow"><span/> THE OPERATING PLATFORM</div><h2>One connected view.<br/><em>Across the work that matters.</em></h2></div>
            <p>AXIVESTRA is built around a trusted system of record and the intelligence layer that helps people understand what exists, what is connected, what needs attention and what decision comes next.</p>
          </div>
          <div className="ax-public-intelligence-grid" id="intelligence">
            {intelligenceLayers.map((item, index) => {
              const Icon = item.icon;
              return <article className="ax-public-intelligence-card" key={item.title}>
                <div className="ax-public-card-top"><span className="ax-public-card-icon"><Icon size={21}/></span><small>0{index + 1}</small></div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </article>;
            })}
          </div>
        </section>

        <section className="ax-public-workspaces" id="workspaces">
          <div className="ax-public-section-heading ax-public-section-heading-light">
            <div><div className="ax-public-eyebrow"><span/> SIX CONNECTED DOMAINS · SIXTEEN WORKSPACES</div><h2>The existing AXIVESTRA<br/><em>workspaces, connected.</em></h2></div>
            <p>Each domain retains its own fields, records and workflow. Shared relationships and operating services connect information across the platform.</p>
          </div>
          <div className="ax-public-domain-grid">
            {workspaceGroups.map(group => {
              const Icon = group.icon;
              return <article className="ax-public-domain-card" key={group.name}>
                <div className="ax-public-domain-heading"><span><Icon size={19}/></span><div><h3>{group.name}</h3><p>{group.description}</p></div></div>
                <ul>{group.workspaces.map(workspace => <li key={workspace}><span/>{workspace}</li>)}</ul>
              </article>;
            })}
          </div>
        </section>

        <section className="ax-public-section ax-public-operations" id="operations">
          <div className="ax-public-section-heading">
            <div><div className="ax-public-eyebrow"><span/> SHARED OPERATING SERVICES</div><h2>Relationships, evidence<br/><em>and action stay connected.</em></h2></div>
            <p>Shared services support the domain workspaces without replacing their specialist data or workflows.</p>
          </div>
          <div className="ax-public-operations-list">
            <div><Users size={18}/><span><strong>People & organisations</strong><small>Contacts, counterparties, roles and relationships</small></span></div>
            <div><Calculator size={18}/><span><strong>Financial movements</strong><small>Receipts, payments, repayments and commitments</small></span></div>
            <div><FileCheck2 size={18}/><span><strong>Documents & evidence</strong><small>Source records, supporting files and review history</small></span></div>
            <div><Workflow size={18}/><span><strong>Tasks & follow-ups</strong><small>Responsibilities, due dates and next actions</small></span></div>
            <div><ShieldCheck size={18}/><span><strong>Risk, compliance & approvals</strong><small>Reviews, decisions and governance controls</small></span></div>
            <div><BriefcaseBusiness size={18}/><span><strong>Portfolio & deal operations</strong><small>Connected work across assets, deals, funds and investors</small></span></div>
          </div>
        </section>

        <section className="ax-public-final-cta">
          <div className="ax-public-final-symbol"><img src="./axivestra-mark.svg" alt=""/></div>
          <div><div className="ax-public-eyebrow"><span/> ONE AXIVESTRA EXPERIENCE</div><h2>Your workspace. Your intelligence.<br/><em>One connected platform.</em></h2><p>Open the AXIVESTRA application you already know. The website and application share the same product interface after sign-in.</p></div>
          <div className="ax-public-actions ax-public-actions-final">
            {signInEnabled && <button type="button" className="ax-public-primary" onClick={onSignIn}>Sign in securely <ArrowRight size={17}/></button>}
            <button type="button" className="ax-public-secondary" onClick={onContinueLocally}>Continue locally <ArrowRight size={16}/></button>
          </div>
        </section>
      </main>

      <footer className="ax-public-footer">
        <a className="ax-public-brand" href="#home" onClick={event => { event.preventDefault(); goTo("home"); }}>
          <img src="./axivestra-mark.svg" alt=""/>
          <span><strong>AXIVESTRA</strong><small>ASSET INTELLIGENCE PLATFORM</small></span>
        </a>
        <p>AXIVESTRA brings your recorded information and authorized integrations into one connected workspace. External data feeds are available only where a provider connection has been configured and verified.</p>
        <span>© {new Date().getFullYear()} AXIVESTRA</span>
      </footer>
    </div>
  );
}
