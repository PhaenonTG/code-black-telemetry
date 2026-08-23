import React, { useEffect, useState } from 'react'
import shield from './assets/codeblack-shield.png'
import fieldVehicle from './assets/field-vehicle-web.jpg'

const NAV = [
  ['Home', 'home'],
  ['Live', 'live'],
  ['Streams', 'streams'],
  ['Team', 'team'],
  ['About', 'about'],
]

function Icon({ name }) {
  const icons = {
    pulse: 'M3 12h4l2.3-5 4.1 10 2.2-5H21',
    play: 'M9 7l8 5-8 5V7z',
    map: 'M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2V6zM9 4v14M15 6v14',
    shield: 'M12 3l7 3v5c0 4.4-2.7 7.6-7 10-4.3-2.4-7-5.6-7-10V6l7-3z',
    target: 'M12 2v3m0 14v3M2 12h3m14 0h3M12 8a4 4 0 100 8 4 4 0 000-8z',
    brain: 'M9 4a3 3 0 00-3 3v1a3 3 0 00-2 5 3 3 0 002 5v1a3 3 0 003 3m6-18a3 3 0 013 3v1a3 3 0 012 5 3 3 0 01-2 5v1a3 3 0 01-3 3M9 4v16m6-16v16',
    bolt: 'M13 2L5 14h6l-1 8 9-13h-6z',
    radio: 'M8 12a4 4 0 018 0m-11 0a7 7 0 0114 0m-17 0a10 10 0 0120 0',
    arrow: 'M5 12h13m-5-5 5 5-5 5',
    lock: 'M7 11V8a5 5 0 0110 0v3m-11 0h12v10H6V11z',
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={icons[name]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function BrandLockup({ compact = false }) {
  return (
    <span className={`brand-lockup ${compact ? 'compact' : ''}`}>
      <span className="brand-shield-wrap">
        <img src={shield} alt="Code Black WX shield" className="brand-shield"/>
      </span>
      <span className="brand-wordmark">
        <strong>CODE BLACK <b>WX</b></strong>
        {!compact && <em>FROM WATCHING TO WARNING</em>}
      </span>
    </span>
  )
}

function Header() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const close = () => setOpen(false)
    window.addEventListener('resize', close)
    return () => window.removeEventListener('resize', close)
  }, [])
  return (
    <header className="site-header">
      <a className="brand-link" href="#home" aria-label="Code Black WX home"><BrandLockup/></a>
      <button className="menu" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-label="Open navigation">
        <span/><span/><span/>
      </button>
      <nav className={open ? 'nav open' : 'nav'} aria-label="Primary">
        {NAV.map(([label, id]) => <a key={id} href={`#${id}`} onClick={() => setOpen(false)}>{label}</a>)}
        <a className="ops-link" href="https://ops.codeblackwx.com"><Icon name="lock"/> OPS Portal</a>
      </nav>
    </header>
  )
}

function Hero() {
  return (
    <section id="home" className="hero section-anchor">
      <div className="hero-media" aria-hidden="true"><div className="hero-storm"/><div className="hero-horizon"/></div>
      <div className="hero-vignette"/>
      <div className="wrap hero-content">
        <p className="hero-label">SEVERE WEATHER INTELLIGENCE • FIELD OPERATIONS</p>
        <h1><span>FROM WATCHING</span><strong>TO WARNING.</strong></h1>
        <p className="hero-copy">Code Black WX is a storm chasing and severe weather intelligence team built around real-time data, technology, and experience in the field.</p>
        <div className="hero-actions">
          <a className="btn primary" href="#live"><Icon name="pulse"/> Live chase status</a>
          <a className="btn ghost" href="#streams"><Icon name="play"/> Watch streams</a>
        </div>
        <div className="brand-pillars hero-pillars">
          <span><Icon name="target"/> AWARENESS</span>
          <span><Icon name="brain"/> INTELLIGENCE</span>
          <span><Icon name="shield"/> CONFIDENCE</span>
          <span><Icon name="bolt"/> ACTION</span>
        </div>
      </div>
      <div className="hero-statusbar">
        <div><span>PUBLIC STATUS</span><strong className="status-caution">STANDBY</strong></div>
        <div><span>PRIMARY CHASE REGION</span><strong>AR • OK • KS • MO</strong></div>
        <div><span>OPERATIONS</span><strong>FIELD + REMOTE</strong></div>
        <div><span>PUBLIC SITE</span><strong>CODEBLACKWX.COM</strong></div>
      </div>
    </section>
  )
}

function LiveStatus() {
  return (
    <section id="live" className="section section-anchor">
      <div className="wrap">
        <div className="section-head">
          <div><p className="section-kicker">FIELD STATUS</p><h2>Live chase status</h2></div>
          <div className="status-chip caution"><i/> Standby</div>
        </div>
        <div className="live-grid">
          <article className="status-panel tactical-panel">
            <div className="panel-accent"/>
            <div className="status-message">
              <p className="mini-label">CURRENT PUBLIC STATE</p>
              <h3>No active public chase.</h3>
              <p>When a Code Black unit goes active, this surface will show the current chase region, stream availability, and public field updates without exposing private operations telemetry.</p>
            </div>
            <div className="status-stats">
              <div><span>Units in field</span><strong>—</strong></div>
              <div><span>Target area</span><strong>—</strong></div>
              <div><span>Stream</span><strong>OFFLINE</strong></div>
              <div><span>Last update</span><strong>—</strong></div>
            </div>
          </article>
          <article className="map-preview tactical-panel">
            <div className="map-grid"/><div className="map-route route-a"/><div className="map-route route-b"/>
            <div className="map-state"><Icon name="map"/><strong>PUBLIC LIVE MAP</strong><span>Reserved for sanitized chase status and stream positions</span></div>
          </article>
        </div>
      </div>
    </section>
  )
}

function Streams() {
  const cards = [['PRIMARY CHASE UNIT','Code Black WX'],['PARTNER / FLEET','Fleet contribution'],['SPECIAL COVERAGE','Event stream']]
  return (
    <section id="streams" className="section section-dark section-anchor">
      <div className="wrap">
        <div className="section-head"><div><p className="section-kicker">FIELD VIDEO</p><h2>Watch the chase.</h2></div><span className="muted">No public feeds active</span></div>
        <div className="stream-grid">
          {cards.map(([label,title], i) => (
            <article className="stream-card" key={label}>
              <div className={`stream-media stream-${i+1}`}><div className="stream-scan"/><div className="stream-play"><Icon name="play"/></div><span className="offline-tag">OFFLINE</span></div>
              <div className="stream-copy"><span>{label}</span><strong>{title}</strong></div>
            </article>
          ))}
        </div>
        <p className="section-note">Real streams only. This page stays offline until an authorized feed is actually connected.</p>
      </div>
    </section>
  )
}

function Team() {
  return (
    <section id="team" className="section section-anchor">
      <div className="wrap team-layout">
        <div className="team-copy">
          <p className="section-kicker">FIELD + REMOTE</p>
          <h2>One mission. Two sides of the operation.</h2>
          <p>Code Black WX combines on-scene storm chasing with remote monitoring, live telemetry, and producer support so information moves from the field to the people who need it.</p>
          <div className="team-photo">
            <img src={fieldVehicle} alt="Code Black WX field vehicle, equipped for storm chasing" loading="lazy" />
            <span>Field vehicle, equipped for chase operations</span>
          </div>
        </div>
        <div className="team-rail">
          <article><div className="rail-icon"><Icon name="radio"/></div><div><span>FIELD TEAM</span><strong>Storm Chasing</strong><p>Observation, live video, spotter reporting, and intercept operations.</p></div></article>
          <article><div className="rail-icon"><Icon name="brain"/></div><div><span>REMOTE OPS</span><strong>Analysis + Coordination</strong><p>Monitoring, data review, stream production, and operational support.</p></div></article>
        </div>
      </div>
    </section>
  )
}

function Mission() {
  const items = [['AWARENESS','See what is happening now.','target'],['INTELLIGENCE','Turn data into a useful picture.','brain'],['CONFIDENCE','Keep sources and status honest.','shield'],['ACTION','Make the next decision clearer.','bolt']]
  return (
    <section id="about" className="section mission section-anchor">
      <div className="wrap mission-grid">
        <div className="mission-copy"><p className="section-kicker">OUR MISSION</p><h2>We exist to turn information into action.</h2><p>From live chase video to weather data and field telemetry, Code Black WX is built around one standard: useful information, presented clearly, when decisions matter.</p></div>
        <div className="mission-list">{items.map(([title,copy,icon]) => <article key={title}><div className="mission-icon"><Icon name={icon}/></div><div><strong>{title}</strong><p>{copy}</p></div></article>)}</div>
      </div>
    </section>
  )
}

function InterceptBand() {
  return (
    <section className="intercept-band">
      <div className="wrap intercept-inner">
        <div><span>CODE BLACK WX</span><h2>WE DON'T JUST WATCH THE STORM.<br/><strong>WE INTERCEPT IT.</strong></h2></div>
        <a className="btn ghost" href="#live">Field status <Icon name="arrow"/></a>
      </div>
    </section>
  )
}

function OpsBand() {
  return (
    <section className="ops-band">
      <div className="wrap ops-inner">
        <div className="ops-copy"><p className="section-kicker">CODE BLACK OPS</p><h2>Public site outside. Operations inside.</h2><p>Private fleet telemetry, internal map controls, stream ingest, hardware health, and operational tools stay in the authenticated OPS environment.</p></div>
        <div className="ops-card"><div className="ops-lock"><Icon name="lock"/></div><div><span>AUTHORIZED ACCESS</span><strong>ops.codeblackwx.com</strong></div><a href="https://ops.codeblackwx.com" aria-label="Open OPS Portal"><Icon name="arrow"/></a></div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer>
      <div className="wrap footer-main">
        <div><BrandLockup/><p>Storm chasing and severe weather intelligence.</p></div>
        <div className="footer-tagline"><span>FROM WATCHING</span><strong>TO WARNING</strong></div>
        <div className="footer-links"><a href="#live">Live</a><a href="#streams">Streams</a><a href="#team">Team</a><a href="#about">About</a></div>
      </div>
      <div className="footer-bottom"><div className="wrap"><span>CODEBLACKWX.COM</span><span>@CODEBLACKWX</span><span>PUBLIC SAFETY • SITUATIONAL AWARENESS</span></div></div>
    </footer>
  )
}

export default function App(){return <><Header/><main><Hero/><LiveStatus/><Streams/><Team/><Mission/><InterceptBand/><OpsBand/></main><Footer/></>}
