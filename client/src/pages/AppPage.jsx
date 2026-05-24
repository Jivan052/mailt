import { useState, useRef, useEffect } from 'react'
import {
  Mail, CheckCircle, UploadCloud, RefreshCw, Download,
  ChevronLeft, ChevronRight, ArrowLeft, Filter, X,
  AlertTriangle, Table2, Link, Loader, Plus, Clock,
  ChevronDown, ChevronUp, Trash2, CornerUpLeft
} from 'lucide-react'
import { useVerify } from '../hooks/useVerify.js'
import StatusBadge from '../components/StatusBadge.jsx'
import s from './AppPage.module.css'

const PAGE_SIZE   = 20
const SESSION_KEY = 'mailprobe_sessions'
const ALL_STATUSES = ['Deliverable','Risky','SMTP Blocked','SMTP Failed','No MX Record','Disposable','Invalid Format']

/* ── Session storage ── */
function loadSessions() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || '[]') }
  catch { return [] }
}
function saveSessions(s) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) }
  catch {}
}

/* ── Helpers ── */
function Ck({ val }) {
  if (val === null || val === undefined) return <span className={s.ckSkip}>—</span>
  return val ? <span className={s.ckYes}>✓</span> : <span className={s.ckNo}>✗</span>
}

function exportCSV(rows, filename) {
  const header = ['Email','Format Valid','MX Valid','SMTP Valid','SMTP Blocked','Catch-all','Is Role','Is Disposable','Status','Detail']
  const lines = [header, ...rows.map(r => [
    r.email,
    r.formatValid  ? 'Yes' : 'No',
    r.mxValid      ? 'Yes' : 'No',
    r.smtpValid === null ? 'Not checked' : r.smtpValid ? 'Yes' : 'No',
    r.smtpBlocked  ? 'Yes' : 'No',
    r.isCatchAll   ? 'Yes' : 'No',
    r.isRole       ? 'Yes' : 'No',
    r.isDisposable ? 'Yes' : 'No',
    r.status,
    r.detail || '',
  ])]
  const csv = lines.map(row => row.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\r\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function statusSummary(results) {
  const d  = results.filter(r => r.status === 'Deliverable').length
  const ri = results.filter(r => r.status === 'Risky').length
  return { d, ri, f: results.length - d - ri }
}

/* ── Google Sheets ── */
function parseSheetId(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}
function parseGid(url) {
  const m = url.match(/[#&?]gid=(\d+)/)
  return m ? m[1] : '0'
}
async function fetchSheetEmails(url, onProgress) {
  const id = parseSheetId(url)
  if (!id) throw new Error('No Sheets ID found in that URL.')
  const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${parseGid(url)}`
  onProgress?.('Fetching…')
  let res
  try { res = await fetch(csvUrl) } catch { throw new Error('Could not reach Google Sheets — make sure the sheet is public.') }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('Sheet is private. Share → Anyone with the link → Viewer.')
    throw new Error(`Google returned ${res.status}. Make sure the sheet is public.`)
  }
  const text = await res.text()
  if (!text.trim()) throw new Error('Sheet appears empty.')
  const rows = text.trim().split('\n').map(row => {
    const cells = []; let cur = '', inQ = false
    for (const ch of row) {
      if (ch === '"') inQ = !inQ
      else if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = '' }
      else cur += ch
    }
    cells.push(cur.trim()); return cells
  })
  const headers = rows[0].map(h => h.toLowerCase().replace(/[^a-z]/g,''))
  const colIdx  = headers.findIndex(h => ['email','emails','emailaddress','address','mail','recipient','to'].includes(h))
  const emails  = new Set()
  for (const row of (colIdx >= 0 ? rows.slice(1) : rows)) {
    for (const cell of (colIdx >= 0 ? [row[colIdx]] : row)) {
      const v = String(cell||'').trim().toLowerCase()
      if (v.includes('@') && v.includes('.') && v.length > 4) emails.add(v.replace(/^mailto:/i,''))
    }
  }
  if (!emails.size) throw new Error('No email addresses found — add a column with header "email".')
  onProgress?.(`Found ${emails.size} emails`)
  return [...emails]
}

/* ── Stats ── */
function StatsRow({ results }) {
  const { d, ri, f } = statusSummary(results)
  return (
    <div className={s.statsRow}>
      {[
        { n: results.length, label:'Total',          cls:s.statTotal },
        { n: d,              label:'Deliverable',     cls:s.statGood  },
        { n: ri,             label:'Risky',           cls:s.statWarn  },
        { n: f,              label:'Failed/Invalid',  cls:s.statBad   },
      ].map(({ n, label, cls }) => (
        <div key={label} className={`${s.statTile} ${cls}`}>
          <span className={s.statVal}>{n}</span>
          <span className={s.statLbl}>{label}</span>
        </div>
      ))}
    </div>
  )
}

/* ── Pagination ── */
function Pagination({ page, totalPages, onPage }) {
  if (totalPages <= 1) return null
  const pages = []
  for (let i = 1; i <= totalPages; i++) {
    if (i===1||i===totalPages||(i>=page-1&&i<=page+1)) pages.push(i)
    else if (pages[pages.length-1]!=='…') pages.push('…')
  }
  return (
    <nav className={s.pagination}>
      <button className={s.pageBtn} onClick={()=>onPage(page-1)} disabled={page===1}><ChevronLeft size={13}/></button>
      {pages.map((p,i) => p==='…'
        ? <span key={`e${i}`} className={s.pageEllipsis}>…</span>
        : <button key={p} className={`${s.pageBtn} ${p===page?s.pageBtnActive:''}`} onClick={()=>onPage(p)}>{p}</button>
      )}
      <button className={s.pageBtn} onClick={()=>onPage(page+1)} disabled={page===totalPages}><ChevronRight size={13}/></button>
    </nav>
  )
}

/* ── Toast ── */
function Toast({ message, onDismiss }) {
  useEffect(() => { const t=setTimeout(onDismiss,5000); return ()=>clearTimeout(t) },[onDismiss])
  return (
    <div className={s.toast} role="alert">
      <AlertTriangle size={13}/><span>{message}</span>
      <button className={s.toastClose} onClick={onDismiss}><X size={11}/></button>
    </div>
  )
}

/* ── History panel ── */
function HistoryPanel({ sessions, onContinue, onDelete, onClear, onExport }) {
  const [expanded, setExpanded] = useState(null)
  if (!sessions.length) {
    return (
      <div className={s.historyEmpty}>
        <Clock size={20} className={s.historyEmptyIcon}/>
        <p className={s.historyEmptyTitle}>No saved sessions yet</p>
        <p className={s.historyEmptySub}>
          Sessions are saved when you click <strong>"New session"</strong> after a verification completes.
          Close the tab and they're gone — nothing is stored on a server.
        </p>
      </div>
    )
  }
  return (
    <div className={s.historyList}>
      {sessions.map((sess, i) => {
        const { d, ri, f } = statusSummary(sess.results)
        const isOpen = expanded === sess.id
        return (
          <div key={sess.id} className={`${s.historyItem} ${isOpen?s.historyItemOpen:''}`}>

            {/* Row header */}
            <div className={s.historyRow} onClick={() => setExpanded(isOpen ? null : sess.id)}>
              <div className={s.historyMeta}>
                <span className={s.historyLabel}>Session {sessions.length - i}</span>
                <span className={s.historyTime}><Clock size={10}/>{fmtTime(sess.createdAt)}</span>
              </div>
              <div className={s.historyCounts}>
                <span className={s.hcGood}>{d}✓</span>
                {ri>0&&<span className={s.hcWarn}>{ri}⚠</span>}
                {f>0 &&<span className={s.hcBad}>{f}✗</span>}
                <span className={s.hcTotal}>{sess.results.length} total</span>
              </div>
              <div className={s.historyRowActions}>
                {isOpen ? <ChevronUp size={13} className={s.chevron}/> : <ChevronDown size={13} className={s.chevron}/>}
              </div>
            </div>

            {/* Expanded */}
            {isOpen && (
              <div className={s.historyExpanded}>

                {/* Mini table */}
                <div className={s.historyTableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th className={s.thCenter}>Format</th>
                        <th className={s.thCenter}>MX</th>
                        <th className={s.thCenter}>SMTP</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sess.results.slice(0, 8).map((r, j) => (
                        <tr key={j} className={s.tr}>
                          <td className={s.tdEmail} title={r.email}>{r.email}</td>
                          <td className={s.tdCenter}><Ck val={r.formatValid}/></td>
                          <td className={s.tdCenter}><Ck val={r.mxValid}/></td>
                          <td className={s.tdCenter}><Ck val={r.smtpValid===null?null:(r.smtpValid||r.smtpBlocked)}/></td>
                          <td><StatusBadge status={r.status}/></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {sess.results.length > 8 && (
                    <p className={s.historyMore}>+{sess.results.length-8} more rows</p>
                  )}
                </div>

                {/* Action bar */}
                <div className={s.historyActionBar}>
                  <div className={s.historyActionLeft}>
                    <button className={s.continueBtn} onClick={() => onContinue(sess)}>
                      <CornerUpLeft size={12}/> Continue this session
                    </button>
                    <button className={s.exportSmallBtn} onClick={() => onExport(sess, i)}>
                      <Download size={11}/> Export CSV
                    </button>
                  </div>
                  <button className={s.deleteBtn} onClick={() => onDelete(sess.id)}>
                    <Trash2 size={12}/> Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {sessions.length > 1 && (
        <button className={s.clearAllBtn} onClick={onClear}>
          <Trash2 size={11}/> Clear all history
        </button>
      )}
    </div>
  )
}

/* ── Results table (extracted so it has own filter/page state) ── */
function ResultsTable({ results, verifyStatus }) {
  const [filter, setFilter] = useState('all')
  const [page,   setPage]   = useState(1)
  const topRef = useRef(null)

  const filtered   = filter==='all' ? results : results.filter(r=>r.status===filter)
  const totalPages = Math.ceil(filtered.length/PAGE_SIZE)
  const pageRows   = filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE)

  const counts = ALL_STATUSES.reduce((acc,st) => {
    const n = results.filter(r=>r.status===st).length
    if (n>0) acc[st]=n; return acc
  }, {})

  function handlePage(p) {
    setPage(p)
    topRef.current?.scrollIntoView({ behavior:'smooth', block:'nearest' })
  }

  return (
    <section className={s.resultsCard}>
      <div className={s.resultsHeader} ref={topRef}>
        <span className={s.resultsHeading}>
          Results
          {verifyStatus==='running' && <span className={s.liveChip}><span className={s.liveDot}/>live</span>}
        </span>
        <div className={s.resultsTools}>
          <div className={s.filterWrap}>
            <Filter size={11} className={s.filterIcon}/>
            <select className={s.filterSel} value={filter} onChange={e=>{setFilter(e.target.value);setPage(1)}}>
              <option value="all">All ({results.length})</option>
              {ALL_STATUSES.map(st => counts[st]
                ? <option key={st} value={st}>{st} ({counts[st]})</option>
                : null
              )}
            </select>
          </div>
          <button className={s.exportBtn}
            onClick={() => {
              const rows = filter==='all' ? results : results.filter(r=>r.status===filter)
              const slug = filter==='all' ? 'all' : filter.toLowerCase().replace(/\s+/g,'-')
              exportCSV(rows, `mailprobe-${slug}-${new Date().toISOString().slice(0,10)}.csv`)
            }}>
            <Download size={12}/>
            Export {filter!=='all'?`"${filter}"`:' all'} ({filtered.length})
          </button>
        </div>
      </div>

      <div className={s.tableWrap} tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Email</th><th className={s.thCenter}>Format</th>
              <th className={s.thCenter}>MX</th><th className={s.thCenter}>SMTP</th>
              <th>Status</th><th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length===0
              ? <tr><td colSpan={6} className={s.emptyRow}>No results match "{filter}"</td></tr>
              : pageRows.map((r,i) => (
                <tr key={r.email+i} className={s.tr}>
                  <td className={s.tdEmail} title={r.email}>{r.email}</td>
                  <td className={s.tdCenter}><Ck val={r.formatValid}/></td>
                  <td className={s.tdCenter}><Ck val={r.mxValid}/></td>
                  <td className={s.tdCenter}><Ck val={r.smtpValid===null?null:(r.smtpValid||r.smtpBlocked)}/></td>
                  <td><StatusBadge status={r.status}/></td>
                  <td className={s.tdDetail}>{r.detail||'—'}</td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>

      <div className={s.tableFooter}>
        <span className={s.footCount}>
          {filter!=='all'
            ? `${filtered.length} of ${results.length} · ${filter}`
            : `${results.length} result${results.length!==1?'s':''} total`}
          {totalPages>1&&` · page ${page} of ${totalPages}`}
        </span>
        <Pagination page={page} totalPages={totalPages} onPage={handlePage}/>
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════════════════
   Main AppPage
═══════════════════════════════════════════════════════ */
export default function AppPage({ onBack }) {
  const [activeTab,    setActiveTab]    = useState('verify')
  const [inputTab,     setInputTab]     = useState('paste')
  const [input,        setInput]        = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [isDragOver,   setIsDragOver]   = useState(false)
  const [sheetUrl,     setSheetUrl]     = useState('')
  const [sheetStatus,  setSheetStatus]  = useState('idle')
  const [sheetMsg,     setSheetMsg]     = useState('')
  const [sheetEmails,  setSheetEmails]  = useState([])
  const [toast,        setToast]        = useState(null)
  const [sessions,     setSessions]     = useState(() => loadSessions())

  const fileRef    = useRef(null)
  const resultsRef = useRef(null)

  const { results, total, done, status, errorMsg, verify, reset } = useVerify()

  const emails    = input.split(/[\n,;]+/).map(e=>e.trim().toLowerCase()).filter(e=>e.includes('@'))
  const isRunning = status === 'running'
  const pct       = total > 0 ? Math.round((done/total)*100) : 0
  const hasResults = results.length > 0

  useEffect(() => {
    if (results.length===1 && resultsRef.current)
      setTimeout(()=>resultsRef.current.scrollIntoView({behavior:'smooth',block:'nearest'}),200)
  },[results.length])

  useEffect(() => {
    if (status==='error' && errorMsg) setToast(errorMsg)
  },[status, errorMsg])

  /* Save current results to history + reset for new session */
  function handleNewSession() {
    if (results.length > 0) {
      const sess = { id: Date.now(), createdAt: new Date().toISOString(), results }
      setSessions(prev => {
        const updated = [sess, ...prev].slice(0, 20)
        saveSessions(updated)
        return updated
      })
    }
    reset()
    setInput('')
    setSelectedFile(null)
    setSheetUrl(''); setSheetStatus('idle'); setSheetEmails([])
    if (fileRef.current) fileRef.current.value = ''
    setActiveTab('verify')
  }

  /* Load a session back into verify tab (continue editing) */
  function handleContinue(sess) {
    // Restore the emails from that session as text so user can edit/re-verify
    const emailList = sess.results.map(r=>r.email).join('\n')
    reset()
    setInput(emailList)
    setInputTab('paste')
    setActiveTab('verify')
    setToast(null)
  }

  function handleDelete(id) {
    setSessions(prev => {
      const updated = prev.filter(s=>s.id!==id)
      saveSessions(updated)
      return updated
    })
  }

  function handleClear() {
    setSessions([]); saveSessions([])
  }

  function handleExportSession(sess, i) {
    exportCSV(sess.results, `session-${sessions.length-i}-${new Date(sess.createdAt).toISOString().slice(0,10)}.csv`)
  }

  async function handleVerify() {
    reset(); setToast(null)
    if (inputTab==='csv' && selectedFile) {
      await verify({ file: selectedFile })
    } else if (inputTab==='sheet') {
      if (!sheetEmails.length) { setToast('Fetch the sheet first, then verify.'); return }
      await verify({ emails: sheetEmails.slice(0,500) })
    } else {
      await verify({ emails })
    }
  }

  function handleKey(e) {
    if ((e.metaKey||e.ctrlKey) && e.key==='Enter') handleVerify()
  }

  function handleRetry() {
    const failed = results.filter(r=>['SMTP Failed','SMTP Blocked','No MX Record'].includes(r.status)).map(r=>r.email)
    if (!failed.length) return
    setInput(failed.join('\n')); setInputTab('paste')
  }

  function handleFileSelect(f) {
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.csv')) { setToast('Only .csv files accepted.'); return }
    if (f.size>2*1024*1024) { setToast('File too large. Max 2 MB.'); return }
    setSelectedFile(f)
  }

  async function handleFetchSheet() {
    if (!sheetUrl.trim()) return
    setSheetStatus('fetching'); setSheetMsg('Fetching…'); setSheetEmails([])
    try {
      const list = await fetchSheetEmails(sheetUrl.trim(), msg=>setSheetMsg(msg))
      setSheetEmails(list); setSheetStatus('ready')
      setSheetMsg(`${list.length} email${list.length!==1?'s':''} found${list.length>500?' — first 500 will be verified':''}`)
    } catch(err) {
      setSheetStatus('error'); setSheetMsg(err.message); setSheetEmails([])
    }
  }

  const canVerify = !isRunning && (
    inputTab==='paste' ? emails.length>0 :
    inputTab==='csv'   ? !!selectedFile :
    sheetEmails.length>0
  )
  const hasFailed = results.some(r=>['SMTP Failed','SMTP Blocked'].includes(r.status))

  const INPUT_TABS = [
    { id:'paste', label:'Paste',         icon:<Mail size={12}/> },
    { id:'csv',   label:'CSV',           icon:<UploadCloud size={12}/> },
    { id:'sheet', label:'Google Sheets', icon:<Table2 size={12}/> },
  ]

  return (
    <div className={s.shell}>

      {/* ── Sidebar ── */}
      <aside className={s.sidebar}>
        <div className={s.sideTop}>
          <div className={s.brand}>
            <div className={s.brandIcon}><Mail size={13} strokeWidth={2.2}/></div>
            <span className={s.brandName}>MailProbe</span>
          </div>
        </div>

        <nav className={s.nav}>
          <span className={s.navSection}>Verify</span>

          <button
            className={`${s.navItem} ${activeTab==='verify'?s.navActive:''}`}
            onClick={() => setActiveTab('verify')}
          >
            <CheckCircle size={14}/>
            <span>Verify</span>
          </button>

          <button
            className={`${s.navItem} ${activeTab==='history'?s.navActive:''}`}
            onClick={() => setActiveTab('history')}
          >
            <Clock size={14}/>
            <span>History</span>
            {sessions.length > 0 && (
              <span className={s.navCount}>{sessions.length}</span>
            )}
          </button>

          {/* New session — lives in nav, only shows when there are results */}
          {hasResults && !isRunning && (
            <div className={s.navDivider} />
          )}
          {hasResults && !isRunning && (
            <button className={s.navNewSession} onClick={handleNewSession}>
              <Plus size={13}/>
              <span>New session</span>
            </button>
          )}
        </nav>

        <div className={s.sideBottom}>
          <button className={s.backBtn} onClick={onBack}>
            <ArrowLeft size={13}/> Back to home
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className={s.main}>

        <header className={s.topbar}>
          <div className={s.topbarLeft}>
            <h1 className={s.pageTitle}>{activeTab==='history'?'History':' Verify'}</h1>
            <span className={s.pageBadge}>Beta</span>
          </div>
          {activeTab==='verify' && (
            <span className={s.kbdHint}>
              <kbd>⌘</kbd><kbd>↵</kbd>
              <span className={s.kbdLbl}>verify</span>
            </span>
          )}
        </header>

        <div className={s.scrollArea}>

          {/* ═══ HISTORY ═══ */}
          {activeTab==='history' && (
            <div className={s.historySection}>
              <div className={s.historySectionHead}>
                <div>
                  <p className={s.historySectionTitle}>Session history</p>
                  <p className={s.historySectionSub}>Stored in this browser tab only — clears when you close the tab.</p>
                </div>
              </div>
              <HistoryPanel
                sessions={sessions}
                onContinue={handleContinue}
                onDelete={handleDelete}
                onClear={handleClear}
                onExport={handleExportSession}
              />
            </div>
          )}

          {/* ═══ VERIFY ═══ */}
          {activeTab==='verify' && (
            <>
              <section className={s.card}>
                {/* Input tabs */}
                <div className={s.tabs} role="tablist">
                  {INPUT_TABS.map(t => (
                    <button key={t.id}
                      className={`${s.tab} ${inputTab===t.id?s.tabActive:''}`}
                      role="tab" aria-selected={inputTab===t.id}
                      onClick={() => setInputTab(t.id)}
                    >{t.icon}{t.label}</button>
                  ))}
                </div>

                {/* Paste */}
                {inputTab==='paste' && (
                  <div className={s.pane}>
                    <div className={s.taShell}>
                      <textarea className={s.ta} rows={9} value={input}
                        onChange={e=>setInput(e.target.value)} onKeyDown={handleKey}
                        placeholder={"user@example.com\nhello@domain.org\ncontact@company.com\n\nOne per line — commas and semicolons also work"}
                        spellCheck={false} autoCorrect="off"/>
                    </div>
                    <div className={s.paneFoot}>
                      <span className={s.countLbl}>
                        <span className={emails.length>0?s.countActive:s.countDim}>{emails.length}</span>
                        {' '}email{emails.length!==1?'s':''} detected
                      </span>
                      <button className={s.ghostBtn} onClick={()=>setInput('')}>Clear</button>
                    </div>
                  </div>
                )}

                {/* CSV */}
                {inputTab==='csv' && (
                  <div className={s.pane}>
                    <div className={`${s.dropzone} ${isDragOver?s.dropzoneOver:''}`}
                      onDragOver={e=>{e.preventDefault();setIsDragOver(true)}}
                      onDragLeave={()=>setIsDragOver(false)}
                      onDrop={e=>{e.preventDefault();setIsDragOver(false);handleFileSelect(e.dataTransfer.files[0])}}
                      onClick={()=>fileRef.current?.click()}
                      onKeyDown={e=>e.key==='Enter'&&fileRef.current?.click()}
                      role="button" tabIndex={0}>
                      <UploadCloud size={24} className={s.dropIcon}/>
                      <p className={s.dropTitle}>Drop CSV file here</p>
                      <p className={s.dropSub}>or <span className={s.dropLink}>browse</span></p>
                      <p className={s.dropHint}>Max 2 MB · .csv · needs an <code>email</code> column</p>
                      <input ref={fileRef} type="file" accept=".csv,text/csv" hidden
                        onChange={e=>handleFileSelect(e.target.files[0])}/>
                    </div>
                    {selectedFile && (
                      <div className={s.filePill}>
                        <Mail size={12}/>
                        <span className={s.fileName}>{selectedFile.name}</span>
                        <span className={s.fileSize}>{(selectedFile.size/1024).toFixed(1)} KB</span>
                        <button className={s.pillX} type="button"
                          onClick={()=>{setSelectedFile(null);if(fileRef.current)fileRef.current.value=''}}>
                          <X size={11}/>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Google Sheets */}
                {inputTab==='sheet' && (
                  <div className={s.pane}>
                    <div className={s.sheetInfo}>
                      <Table2 size={14} className={s.sheetInfoIcon}/>
                      <div>
                        <p className={s.sheetInfoTitle}>Paste a public Google Sheets link</p>
                        <p className={s.sheetInfoSub}>Share → Anyone with the link → Viewer. Fetches up to 500 emails.</p>
                      </div>
                    </div>
                    <div className={s.sheetRow}>
                      <div className={s.sheetInputShell}>
                        <Link size={13} className={s.sheetInputIcon}/>
                        <input className={s.sheetInput} type="url" value={sheetUrl}
                          onChange={e=>{setSheetUrl(e.target.value);setSheetStatus('idle');setSheetEmails([])}}
                          placeholder="https://docs.google.com/spreadsheets/d/…"
                          spellCheck={false}
                          onKeyDown={e=>e.key==='Enter'&&handleFetchSheet()}/>
                        {sheetUrl && (
                          <button className={s.sheetInputClear}
                            onClick={()=>{setSheetUrl('');setSheetStatus('idle');setSheetEmails([])}}>
                            <X size={11}/>
                          </button>
                        )}
                      </div>
                      <button className={s.fetchBtn}
                        onClick={handleFetchSheet}
                        disabled={!sheetUrl.trim()||sheetStatus==='fetching'}>
                        {sheetStatus==='fetching'
                          ? <><Loader size={13} className={s.fetchSpin}/>Fetching…</>
                          : 'Fetch sheet'}
                      </button>
                    </div>
                    {sheetStatus!=='idle' && (
                      <div className={`${s.sheetStatusRow} ${sheetStatus==='ready'?s.sheetReady:sheetStatus==='error'?s.sheetError:s.sheetFetching}`}>
                        {sheetStatus==='fetching'&&<Loader size={12} className={s.fetchSpin}/>}
                        {sheetStatus==='ready'   &&<CheckCircle size={12}/>}
                        {sheetStatus==='error'   &&<AlertTriangle size={12}/>}
                        <span>{sheetMsg}</span>
                      </div>
                    )}
                    {sheetEmails.length > 0 && (
                      <div className={s.sheetPreview}>
                        <div className={s.sheetPreviewHead}>
                          <span className={s.sheetPreviewLbl}>Preview</span>
                          <span className={s.sheetPreviewCount}>{Math.min(sheetEmails.length,500)} will be verified</span>
                        </div>
                        <div className={s.sheetPreviewList}>
                          {sheetEmails.slice(0,6).map((e,i)=><span key={i} className={s.sheetPreviewEmail}>{e}</span>)}
                          {sheetEmails.length>6&&<span className={s.sheetPreviewMore}>+{Math.min(sheetEmails.length,500)-6} more</span>}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Action row */}
                <div className={s.actionRow}>
                  <button className={s.verifyBtn} onClick={handleVerify} disabled={!canVerify}>
                    {isRunning
                      ? <><span className={s.spinner}/>Verifying…</>
                      : <><CheckCircle size={14}/>Verify emails</>}
                  </button>
                  {hasFailed && !isRunning && (
                    <button className={s.secondaryBtn} onClick={handleRetry}>
                      <RefreshCw size={13}/>Retry failed
                    </button>
                  )}
                </div>

                {/* Progress */}
                {isRunning && (
                  <div className={s.progressSection}>
                    <div className={s.progressRow}>
                      <span className={s.progressLbl}>Verifying {total} email{total!==1?'s':''}…</span>
                      <span className={s.progressFrac}>{done} / {total||'?'}</span>
                    </div>
                    <div className={s.progressRail} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                      <div className={s.progressBar} style={{width:`${pct}%`}}/>
                    </div>
                    {results.length>0 && (
                      <div className={s.progressLegend}>
                        {[
                          {n:results.filter(r=>r.status==='Deliverable').length,lbl:'deliverable',c:'var(--green)'},
                          {n:results.filter(r=>r.status==='Risky').length,lbl:'risky',c:'var(--amber)'},
                          {n:results.filter(r=>!['Deliverable','Risky'].includes(r.status)).length,lbl:'failed',c:'var(--red)'},
                        ].filter(x=>x.n>0).map(x=>(
                          <span key={x.lbl} className={s.legendItem}>
                            <span className={s.legendDot} style={{background:x.c}}/>{x.n} {x.lbl}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>

              {hasResults && <StatsRow results={results}/>}

              {hasResults && (
                <div ref={resultsRef}>
                  <ResultsTable results={results} verifyStatus={status}/>
                </div>
              )}

              <p className={s.footnote}>
                SMTP checks require outbound port 25 or 587 — blocked on most cloud networks.{' '}
                <em>SMTP Blocked</em> still means format and MX are valid.
              </p>
            </>
          )}

        </div>
      </main>

      {toast && <Toast message={toast} onDismiss={()=>setToast(null)}/>}
    </div>
  )
}
