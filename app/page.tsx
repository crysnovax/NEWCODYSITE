"use client";

import { motion } from "framer-motion";
import { ArrowRight, Check, CircleDot, Code2, Grid2X2, Link2, Menu, Puzzle, Radio, Shuffle, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { BackgroundMotion } from "@/components/background-motion";
import Link from "next/link";

const services = [
  { id: "ai", href: "/services", index: "04 / SERVICES", title: "CRYSNOVA services", copy: "Explore AI, APIs, CDN, ban check, PDF, backup, and the wider service network.", icon: Sparkles, tone: "cyan" },
  { id: "connect", href: "/pair", index: "01 / CONNECT", title: "Pair & deploy", copy: "Generate a pair code, QR code, or deployment script through the original CODY_PAIR console.", icon: Link2, tone: "green" },
  { id: "extend", href: "/plugins", index: "02 / EXTEND", title: "Plugin store", copy: "Write, submit, review, and publish community extensions to the CRYSNOVA CDN.", icon: Puzzle, tone: "purple" },
  { id: "build", href: "/api", index: "03 / BUILD", title: "Developer API", copy: "Start from cody_api and build services around CODY and CRYSNOVA AI.", icon: Code2, tone: "cyan" },
];

const previews = {
  overview: { label: "OVERVIEW", title: "Everything has a home.", lines: ["Welcome back, operator.", "PLOGME workspace connected.", "Ready for your next build."] },
  pair: { label: "PAIR CONSOLE", title: "Connect a device.", lines: ["Pair service ready.", "Waiting for WhatsApp number...", "Generate a code or QR to continue."] },
  plugins: { label: "PLUGIN STORE", title: "Extend the ecosystem.", lines: ["Marketplace connected.", "24 approved extensions available.", "Submit a plugin for admin review."] },
  api: { label: "DEVELOPER API", title: "Build on the core.", lines: ["cody_api gateway operational.", "Authentication layer ready.", "Listening for your next request."] },
} as const;
type PreviewKey = keyof typeof previews;

function ConsolePreview() {
  const [active, setActive] = useState<PreviewKey>("overview");
  const preview = previews[active];
  const tabs: { key: PreviewKey; label: string; icon: typeof Grid2X2 }[] = [
    { key: "overview", label: "Overview", icon: Grid2X2 }, { key: "pair", label: "Pair console", icon: Link2 }, { key: "plugins", label: "Plugins", icon: Puzzle }, { key: "api", label: "API", icon: Code2 },
  ];
  const cycle = () => setActive(tabs[(tabs.findIndex((tab) => tab.key === active) + 1) % tabs.length].key);
  return <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} className="console-window">
    <div className="console-chrome"><div className="traffic-lights"><i /><i /><i /></div><div className="console-address"><span className="lock">●</span> plogme / console <span className="address-live">● live</span></div><button onClick={cycle} aria-label="Cycle website preview" className="icon-button"><Shuffle size={15} /></button></div>
    <div className="console-body"><aside className="console-sidebar"><div className="mini-brand"><span>⚉</span> PLOGME</div><div className="mini-nav">{tabs.map(({ key, label, icon: Icon }) => <button key={key} className={active === key ? "active" : ""} onClick={() => setActive(key)}><Icon size={14} /> {label}</button>)}</div><div className="mini-user"><span className="avatar">C</span><small>CRYSN⚉VA<br /><b>operator</b></small></div></aside>
      <div className="console-content"><div className="console-topline"><div><small className="mono-label">WORKSPACE / <span>{preview.label}</span></small><h3>{preview.title}</h3></div><span className="synced"><Radio size={12} /> synced now</span></div><div className="stats"><div><small>CORE STATUS</small><strong className="green-text">ONLINE</strong><span>all systems normal</span></div><div><small>PAIR SERVICE</small><strong>READY</strong><span>awaiting device</span></div><div><small>COMMUNITY</small><strong>24</strong><span>published plugins</span></div></div><div className="terminal"><div className="terminal-head"><span>plogme@console:~$</span><span className="terminal-live">● streaming</span></div><div className="terminal-lines">{preview.lines.map((line, index) => <p key={line}><b>0{index + 1}</b> {line}{index === preview.lines.length - 1 && <span className="cursor" />}</p>)}</div></div></div></div>
  </motion.div>;
}

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  return <main className="home-shell"><BackgroundMotion />
    <nav className="topbar"><a className="brand" href="#top"><span className="brand-mark">⚉</span><span>PLOGME</span><em>COMMUNITY</em></a><div className={`nav-links ${menuOpen ? "open" : ""}`}><a href="#top">Home</a><a href="#preview">Preview</a><a href="#ecosystem">Ecosystem</a><Link href="/community">Community</Link></div><div className="nav-actions"><span className="live"><CircleDot size={10} /> SYSTEMS ONLINE</span><button className="menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation">{menuOpen ? <X size={17} /> : <Menu size={17} />}</button></div></nav>
    <section id="top" className="hero-section"><div className="eyebrow">/ CRYSN⚉VA AI · COMMUNITY OPERATING SYSTEM</div><h1>Build with <span>intention.</span><br />Ship with PLOGME.</h1><p className="hero-lede">The focused home for CRYSNOVA AI and CODY. Pair a device, deploy with confidence, publish extensions, and keep the whole ecosystem in view.</p><div className="hero-actions"><a className="pill-button primary" href="#preview">Enter PLOGME <ArrowRight size={15} /></a><a className="pill-button secondary" href="#ecosystem">Read the guides</a></div><div className="hero-proof"><span><Check size={13} /> CODY_PAIR ready</span><span><Check size={13} /> CDN marketplace</span><span><Check size={13} /> Live AI support</span></div></section>
    <section id="preview" className="preview-section"><div className="section-kicker">01 / LIVE WEBSITE PREVIEW</div><div className="section-heading"><div><h2>See the system before you enter it.</h2><p>A quiet command center for the projects, people, and services behind CRYSN⚉VA AI.</p></div><span className="preview-status"><i /> LIVE PREVIEW</span></div><ConsolePreview /></section>
    <section id="ecosystem" className="ecosystem-section"><div className="feature-intro"><div className="section-kicker">02 / THE ECOSYSTEM</div><h2>Everything essential.<br /><span>Nothing noisy.</span></h2><p>PLOGME gives every part of the CRYSN⚉VA AI ecosystem its own clear place, while the system stays connected underneath.</p><a className="text-link" href="#footer">Explore all services <ArrowRight size={14} /></a></div><div className="feature-grid">{services.map((service, i) => { const Icon = service.icon; return <motion.a href={service.href} key={service.id} initial={{ opacity: 0, y: 24, filter: "blur(10px)" }} whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }} viewport={{ once: true }} transition={{ duration: 0.48, delay: i * 0.035, ease: [0.2, 0.7, 0.2, 1] }} className="feature-card"><span className={`feature-icon ${service.tone}`}><Icon size={19} /></span><small>{service.index}</small><h3>{service.title}</h3><p>{service.copy}</p><span className="card-arrow">→</span></motion.a>; })}</div></section>
    <section className="cta-section"><div><div className="section-kicker">03 / READY WHEN YOU ARE</div><h2>Make the next move<br /><span>visible.</span></h2></div><div><p>Open the console, follow a deployment path, or ask CODY AI for a direct answer.</p><a className="pill-button primary" href="#preview">Enter PLOGME <ArrowRight size={15} /></a></div></section>
    <footer id="footer"><div className="footer-mark">⚉</div><div>PLOGME is the CRYSN⚉VA AI community hub. Built around <a href="https://github.com/crysnovax/CODY">CODY</a>, powered by builders, and maintained by <a href="https://t.me/crysnovax">@crysnovax</a>.</div><div className="footer-links"><a href="#ecosystem">Tutorials</a><a href="#ecosystem">Plugin store</a><a href="#ecosystem">Developer API</a><a href="#top">Community</a></div></footer>
  </main>;
}
