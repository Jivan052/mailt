import { useState, useRef, useEffect } from 'react'
import { ArrowRight, Mail, Shield, Zap, BarChart3, Users, Globe, CheckCircle } from 'lucide-react'
import { useVerify } from '../hooks/useVerify.js'
import StatusBadge   from '../components/StatusBadge.jsx'
import s             from './LandingPage.module.css'

const FREE_LIMIT = 3
const CHECKS_KEY = 'mailprobe_checks'

function LockIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 14 14" fill="none">
      <rect x="2" y="6" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  )
}

function Ck({ val }) {
  if (val === null || val === undefined) return <span className={s.ckSkip}>—</span>
  return val ? <span className={s.ckYes}>✓</span> : <span className={s.ckNo}>✗</span>
}

function ResultCard({ r, idx }) {
  return (
    <div className={s.resultCard} style={{ animationDelay: `${idx * 45}ms` }}>
      <div className={s.rcTop}>
        <span className={s.rcEmail}>{r.email}</span>
        <StatusBadge status={r.status} />
      </div>
      <div className={s.rcChecks}>
        <span className={s.rcCheck}><span className={s.rcLbl}>Format</span><Ck val={r.formatValid} /></span>
        <span className={s.rcCheck}><span className={s.rcLbl}>MX</span><Ck val={r.mxValid} /></span>
        <span className={s.rcCheck}>
          <span className={s.rcLbl}>SMTP</span>
          <Ck val={r.smtpValid === null ? null : (r.smtpValid || r.smtpBlocked)} />
        </span>
      </div>
      {r.detail && <p className={s.rcDetail}>{r.detail}</p>}
    </div>
  )
}

export default function LandingPage({ onEnterApp }) {
  const [input,      setInput]      = useState('')
  const [checksUsed, setChecksUsed] = useState(
    () => parseInt(localStorage.getItem(CHECKS_KEY) || '0', 10)
  )
  const { results, total, done, status, errorMsg, verify } = useVerify()
  const resultsRef = useRef(null)

  const emails    = input.split(/[\n,;]+/).map(e => e.trim().toLowerCase()).filter(e => e.includes('@'))
  const isRunning = status === 'running'
  const pct       = total > 0 ? Math.round((done / total) * 100) : 0
  const remaining = Math.max(0, FREE_LIMIT - checksUsed)
  const isLocked  = checksUsed >= FREE_LIMIT

  // Scroll to results when first result arrives
  useEffect(() => {
    if (results.length === 1 && resultsRef.current) {
      setTimeout(() => resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150)
    }
  }, [results.length])

  async function handleVerify() {
    if (!emails.length || isLocked || isRunning) return
    const toCheck = emails.slice(0, remaining)
    await verify({ emails: toCheck })
    const n = checksUsed + toCheck.length
    setChecksUsed(n)
    localStorage.setItem(CHECKS_KEY, String(n))
  }

  function handleKey(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleVerify()
  }

  return (
    <div className={s.page}>

      {/* Line grid background */}
      <div className={s.lineGrid} aria-hidden>
        <div className={s.lineGridInner} />
      </div>
      <div className={s.topFade} aria-hidden />

      {/* ── Nav ── */}
      <nav className={s.nav}>
        <div className={s.navInner}>
          <div className={s.brand}>
            <div className={s.brandIcon}><Mail size={13} strokeWidth={2.2} /></div>
            <span className={s.brandName}>MailT</span>
          </div>
          <div className={s.navRight}>
            <a href="#features" className={s.navLink}>Features</a>
            <a href="#usecases" className={s.navLink}>Use cases</a>
            <div className={s.navDivider} />
            <button className={s.navCta} onClick={onEnterApp}>
              Verify in bulk <ArrowRight size={12} />
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className={s.hero}>
        <div className={s.heroInner}>

          <div className={s.heroBadge}>
            <span className={s.badgeDot} />
            Free to try
          </div>

          <h1 className={s.heroTitle}>
            Know if your emails<br /><em>actually land.</em>
          </h1>

          <p className={s.heroSub}>
            Validate format, DNS/MX records and SMTP deliverability before you send.
          </p>

          {/* ── Checker card ── */}
          <div className={s.checker}>
            <div className={s.checkerHead}>
              <div className={s.checkerLive}>
                <span className={s.liveDot} />
                <span>Live checker</span>
              </div>
              <span className={`${s.checkerRemaining} ${isLocked ? s.checkerRemainingLocked : ''}`}>
                {isLocked ? 'Free limit reached' : `${remaining} free check${remaining !== 1 ? 's' : ''} left`}
              </span>
            </div>

            <div className={`${s.taWrap} ${isLocked ? s.taWrapLocked : ''}`}>
              <textarea
                className={s.ta}
                rows={4}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder={isLocked
                  ? 'Free limit reached — use the full dashboard to verify more'
                  : 'user@example.com\ncontact@company.org\nhello@domain.com'}
                spellCheck={false}
                autoCorrect="off"
                disabled={isLocked}
              />
            </div>

            <div className={s.checkerFoot}>
              <span className={s.emailCount}>
                {isLocked
                  ? 'All 3 free checks used'
                  : emails.length > 0
                    ? `${emails.length} email${emails.length !== 1 ? 's' : ''} detected`
                    : 'One per line'}
              </span>
              <div className={s.footRight}>
                {!isLocked && <span className={s.kbdTip}><kbd>⌘</kbd><kbd>↵</kbd></span>}
                <button
                  className={s.verifyBtn}
                  onClick={handleVerify}
                  disabled={!emails.length || isRunning || isLocked}
                >
                  {isRunning
                    ? <><span className={s.spinner} />Verifying…</>
                    : <>Verify now <ArrowRight size={13} /></>}
                </button>
              </div>
            </div>

            {isRunning && (
              <div className={s.progressWrap}>
                <div className={s.progressRail}>
                  <div className={s.progressFill} style={{ width: `${pct}%` }} />
                </div>
                <span className={s.progressTxt}>{done} / {total || '?'}</span>
              </div>
            )}

            {status === 'error' && (
              <div className={s.errorBanner}>{errorMsg}</div>
            )}
          </div>

          {/* ── Results ── */}
          {results.length > 0 && (
            <div ref={resultsRef} className={s.resultsArea}>
              <div className={s.resultsTop}>
                <span className={s.resultsLbl}>
                  {isRunning
                    ? `Checking… ${done}/${total}`
                    : `${results.length} result${results.length !== 1 ? 's' : ''}`}
                </span>
              </div>
              <div className={s.resultsList}>
                {results.map((r, i) => <ResultCard key={r.email + i} r={r} idx={i} />)}
              </div>
            </div>
          )}

          {/* ── Locked CTA — shown once limit is hit ── */}
          {isLocked && (
            <div className={s.lockedCta}>
              <div className={s.lockedLeft}>
                <div className={s.lockedIcon}><LockIcon /></div>
                <div>
                  <p className={s.lockedTitle}>Free limit reached</p>
                  <p className={s.lockedSub}>You've used all {FREE_LIMIT} free checks.</p>
                </div>
              </div>
              <button className={s.bulkBtn} onClick={onEnterApp}>
                Verify in bulk <ArrowRight size={13} />
              </button>
            </div>
          )}

          {/* ── Subtle bulk CTA — shown while still under limit ── */}
          {!isLocked && (
            <div className={s.bulkCta}>
              <span className={s.bulkCtaText}>Need to verify hundreds at once?</span>
              <button className={s.bulkCtaBtn} onClick={onEnterApp}>
                Verify in bulk <ArrowRight size={12} />
              </button>
            </div>
          )}

        </div>
      </section>

      {/* ── Features ── */}
      <section className={s.features} id="features">
        <div className={s.sectionInner}>
          <div className={s.sectionEye}>What we check</div>
          <h2 className={s.sectionTitle}>Four layers of verification</h2>
          <div className={s.featureGrid}>
            {FEATURES.map((f, i) => (
              <div key={i} className={s.featureCard} style={{ animationDelay: `${i * 60}ms` }}>
                <div className={s.featureIconWrap} style={{ background: f.bg, color: f.color }}>
                  {f.icon}
                </div>
                <div className={s.featureNum}>0{i + 1}</div>
                <h3 className={s.featureTitle}>{f.title}</h3>
                <p className={s.featureDesc}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Use cases ── */}
      <section className={s.usecases} id="usecases">
        <div className={s.sectionInner}>
          <div className={s.sectionEye}>Use cases</div>
          <h2 className={s.sectionTitle}>Built for teams who send at scale</h2>
          <p className={s.sectionSub}>500 emails per batch. CSV upload. Google Sheets import. Filter and export by status.</p>
          <div className={s.usecaseGrid}>
            {USECASES.map((u, i) => (
              <div key={i} className={s.usecaseCard}>
                <div className={s.usecaseHead}>
                  <div className={s.usecaseIconWrap} style={{ background: u.bg, color: u.color }}>{u.icon}</div>
                  <div>
                    <div className={s.usecaseRole}>{u.role}</div>
                    <h3 className={s.usecaseTitle}>{u.title}</h3>
                  </div>
                </div>
                <p className={s.usecaseDesc}>{u.desc}</p>
                <ul className={s.usecaseList}>
                  {u.points.map((p, j) => (
                    <li key={j}><CheckCircle size={11} className={s.ptCheck} />{p}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Bottom CTA */}
        </div>
      </section>

      {/* ── Footer note ── */}
      <div className={s.footNote}>
        SMTP checks require outbound port 25 or 587 — blocked on most cloud hosts.
        <em> SMTP Blocked</em> still means format + MX are valid.
      </div>

    </div>
  )
}

/* ── Data ── */
const FEATURES = [
  {
    title: 'Format Validation',
    desc:  'RFC-compliant checks — length limits, no consecutive dots, valid TLD, disposable and role-address detection.',
    icon: <Shield size={15} />, bg: '#f0fdf4', color: '#15803d',
  },
  {
    title: 'DNS / MX Lookup',
    desc:  '5-second timeout DNS with per-domain caching. Same domain across 500 emails = one lookup.',
    icon: <Globe size={15} />, bg: '#eff6ff', color: '#1d4ed8',
  },
  {
    title: 'SMTP Probe',
    desc:  'Raw TCP EHLO → MAIL FROM → RCPT TO on ports 25 and 587. No email sent — just a handshake.',
    icon: <Zap size={15} />, bg: '#fffbeb', color: '#92400e',
  },
  {
    title: 'Catch-All Detection',
    desc:  'Probes a fake address after acceptance to flag domains that silently accept everything.',
    icon: <BarChart3 size={15} />, bg: '#faf5ff', color: '#6d28d9',
  },
]

const USECASES = [
  {
    role:   'Email Marketers',
    title:  'Protect sender reputation',
    desc:   'High bounce rates destroy your domain score. Clean your list before every campaign send.',
    icon:   <Mail size={15} />, bg: '#f0fdf4', color: '#15803d',
    points: ['Reduce bounce rate below 2%', 'Remove disposable addresses in bulk', 'CSV upload — up to 500 per batch'],
  },
  {
    role:   'Sales Teams',
    title:  'Qualify leads instantly',
    desc:   'Stop burning quota on bad contacts. Verify prospects the moment they enter your CRM.',
    icon:   <Users size={15} />, bg: '#eff6ff', color: '#1d4ed8',
    points: ['Filter and export results by status', 'Catch typos before first contact', 'Batch process entire lead lists'],
  },
  {
    role:   'Developers',
    title:  'Validate at point of entry',
    desc:   'Embed verification in your signup flow. Streaming NDJSON keeps your UI responsive.',
    icon:   <Zap size={15} />, bg: '#fffbeb', color: '#92400e',
    points: ['POST /verify REST endpoint', 'Streaming NDJSON — no polling', 'Full status taxonomy with detail field'],
  },
  {
    role:   'Growth Teams',
    title:  'Scale list hygiene',
    desc:   'Run scheduled jobs against your database and flag risky records before each send.',
    icon:   <BarChart3 size={15} />, bg: '#faf5ff', color: '#6d28d9',
    points: ['500 emails per batch request', 'Catch-all + SMTP-blocked flags', 'MX caching for speed at scale'],
  },
]
