import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || '';
const L = { met: 'Met', weak: 'Weak', missing: 'Missing' };
const C = { met: 'var(--met)', weak: 'var(--weak)', missing: 'var(--miss)' };
const STEPS = ['Reading the tender', 'Reading your documents', 'Matching and scoring'];

const size = b => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function Ico({ s }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {s === 'met' ? <path d="M3 8.5l3.2 3L13 4.5" /> : s === 'weak' ? <path d="M8 3.5v5.5M8 12.2v.01" /> : <path d="M4 4l8 8M12 4l-8 8" />}
    </svg>
  );
}

function Drop({ n, title, hint, multiple, max, files, onFiles, onRemove }) {
  const [over, setOver] = useState(false);
  const pick = fl => {
    const pdfs = [...fl].filter(f => f.type === 'application/pdf');
    if (pdfs.length) onFiles(pdfs);
  };
  return (
    <label
      className={`drop ${over ? 'over' : ''} ${files.length ? 'has' : ''}`}
      onDragOver={e => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
    >
      <div className="drop-top">
        <span className="up">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13V3M6 6.5L10 3l4 3.5M3.5 13v2.5a1.5 1.5 0 001.5 1.5h10a1.5 1.5 0 001.5-1.5V13" /></svg>
        </span>
        <div>
          <h3><span className="n">{n}</span>{title}</h3>
          <p>{hint}</p>
        </div>
        {multiple && <span className="count">{files.length}/{max}</span>}
      </div>
      <input type="file" accept="application/pdf" multiple={multiple} onChange={e => { pick(e.target.files); e.target.value = ''; }} />
      {files.length > 0 && (
        <div className="files">
          {files.map((f, i) => (
            <div className="file" key={`${f.name}-${i}`}>
              <span className="pdf">PDF</span>
              <span className="fname">{f.name}</span>
              <span className="fsize">{size(f.size)}</span>
              <button type="button" className="x" aria-label={`Remove ${f.name}`} onClick={e => { e.preventDefault(); e.stopPropagation(); onRemove(i); }}>×</button>
            </div>
          ))}
        </div>
      )}
    </label>
  );
}

function Gauge({ score }) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf, start;
    const dur = 1100;
    const tick = t => {
      if (!start) start = t;
      const k = Math.min((t - start) / dur, 1);
      setP(Math.round(score * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score]);
  const col = score >= 80 ? C.met : score >= 55 ? C.weak : C.missing;
  const R = 74, T = 2 * Math.PI * R;
  return (
    <div className="gauge">
      <svg width="176" height="176" viewBox="0 0 170 170">
        <circle cx="85" cy="85" r={R} fill="none" stroke="#e7ebf6" strokeWidth="12" />
        <circle cx="85" cy="85" r={R} fill="none" stroke={col} strokeWidth="12" strokeLinecap="round" strokeDasharray={T} strokeDashoffset={T * (1 - p / 100)} />
      </svg>
      <div className="num" style={{ color: col }}>{p}<small>out of 100</small></div>
    </div>
  );
}

export default function App() {
  const [tender, setTender] = useState([]);
  const [docs, setDocs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState('');
  const [r, setR] = useState(null);
  const [tab, setTab] = useState('all');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const t = setInterval(() => setStep(s => Math.min(s + 1, 2)), 14000);
    return () => clearInterval(t);
  }, [busy]);

  const addDocs = f => setDocs(d => {
    const m = [...d];
    f.forEach(x => { if (!m.some(y => y.name === x.name && y.size === x.size)) m.push(x); });
    return m.slice(0, 10);
  });

  async function run() {
    setBusy(true); setErr(''); setR(null); setTab('all');
    const fd = new FormData();
    fd.append('tender', tender[0]);
    docs.forEach(d => fd.append('documents', d));
    try {
      const res = await fetch(`${API}/api/analyze`, { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
      setR(j);
      setTimeout(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function copyLetter() {
    try {
      await navigator.clipboard.writeText(r.coverLetter);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked */ }
  }

  const req = id => r.requirements.find(x => x.id === id) || {};
  const doc = id => r.documents.find(x => x.id === id)?.filename || id;
  const shown = r ? r.verdicts.filter(v => tab === 'all' || v.status === tab) : [];
  const total = r ? Math.max(1, r.counts.met + r.counts.weak + r.counts.missing) : 1;
  const pct = k => `${(r.counts[k] / total) * 100}%`;

  return (<>
    <header className="hero noprint">
      <div className="glow a" /><div className="glow b" />
      <div className="wrap">
        <nav className="nav">
          <div className="brand"><span className="logo"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.2 3L13 4.5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>BidProof</div>
          <span className="tag">Tender eligibility checker</span>
        </nav>

        <div className="hero-grid">
          <div>
            <h1>Find out why a bid would fail <em>before you submit it.</em></h1>
            <p className="lead">Upload the tender and your company papers. BidProof lists every requirement, checks each one against your documents, and shows exactly what to fix.</p>
            <div className="facts">
              <div><b>Every verdict cited</b>document and page</div>
              <div><b>Maths done in code</b>no AI guesswork on numbers</div>
              <div><b>About a minute</b>instead of half a day</div>
            </div>
          </div>

          <aside className="preview" aria-hidden="true">
            <div className="pv-head"><span>Sample report</span><span className="pv-score">72</span></div>
            <div className="pv-bar"><i style={{ width: '58%', background: 'var(--met)' }} /><i style={{ width: '25%', background: 'var(--weak)' }} /><i style={{ width: '17%', background: 'var(--miss)' }} /></div>
            <div className="pv-row"><span className="dot met" />GST registration<b>Met</b></div>
            <div className="pv-row"><span className="dot weak" />Average turnover, 3 years<b>Weak</b></div>
            <div className="pv-row"><span className="dot miss" />Similar work order<b>Missing</b></div>
            <div className="pv-fix">Next step: add a completion certificate for a work of similar value.</div>
          </aside>
        </div>
      </div>
    </header>

    <main className="wrap main">
      <section className="card noprint">
        <div className="card-head">
          <h2>Start a check</h2>
          <span className="hint">Takes about a minute</span>
        </div>
        <div className="drops">
          <Drop n="1" title="Tender document" hint="Drop one text-based PDF here, or click to browse" files={tender} onFiles={f => setTender(f.slice(0, 1))} onRemove={() => setTender([])} />
          <Drop n="2" title="Your company documents" hint="GST, PAN, balance sheets, work orders" multiple max={10} files={docs} onFiles={addDocs} onRemove={i => setDocs(d => d.filter((_, k) => k !== i))} />
        </div>
        <div className="cta">
          <button className="go" disabled={busy || !tender.length || !docs.length} onClick={run}>
            {busy && <span className="spin" />}{busy ? 'Checking your bid...' : 'Check my eligibility'}
          </button>
          <span className="hint">Your files are read only to run this check.</span>
        </div>
        {busy && (
          <div className="steps">
            <div className="track"><i style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
            {STEPS.map((s, i) => <div key={s} className={`stp ${i === step ? 'on' : i < step ? 'done' : ''}`}>{i < step ? 'Done: ' : ''}{s}</div>)}
          </div>
        )}
        {err && <div className="err" role="alert">{err}</div>}
      </section>

      {!r && !busy && (
        <section className="how noprint">
          <h2>How it works</h2>
          <div className="how-grid">
            <div><span>01</span><h3>Read the tender</h3><p>Every eligibility clause is pulled out and tagged mandatory or optional, with its page number.</p></div>
            <div><span>02</span><h3>Match your papers</h3><p>Each requirement is checked against your documents. Numbers are verified in code, not guessed.</p></div>
            <div><span>03</span><h3>Fix and submit</h3><p>Get a score, the gaps that could get you rejected, and a draft cover letter to start from.</p></div>
          </div>
        </section>
      )}

      {r && <div id="results">
        <section className="card"><div className="sum">
          <Gauge score={r.score} />
          <div className="sum-body">
            <h2>{r.notReady ? 'Not ready to submit yet' : r.score >= 80 ? 'Your bid looks strong' : 'Close, with gaps to fix'}</h2>
            <div className="tn">{r.tenderName}</div>
            <div className="dist" role="img" aria-label="Share of requirements met, weak and missing">
              <i style={{ width: pct('met'), background: 'var(--met)' }} />
              <i style={{ width: pct('weak'), background: 'var(--weak)' }} />
              <i style={{ width: pct('missing'), background: 'var(--miss)' }} />
            </div>
            <div className="pills">
              <span className="pill ok">{r.counts.met} met</span>
              <span className="pill wk">{r.counts.weak} weak</span>
              <span className="pill ms">{r.counts.missing} missing</span>
            </div>
            {r.notReady && <div className="banner">{r.counts.blockers} mandatory requirement(s) could get this bid rejected. Fix these first.</div>}
          </div>
        </div></section>

        <div className="bar"><h2>Requirement by requirement</h2>
          <div className="tabs noprint">{['all', 'missing', 'weak', 'met'].map(t => <button key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{t === 'all' ? `All (${r.verdicts.length})` : `${L[t]} (${r.counts[t]})`}</button>)}</div></div>

        {shown.map(v => { const q = req(v.requirementId); return (
          <article className="req" key={v.requirementId} style={{ '--c': C[v.status] }}>
            <span className="ric"><Ico s={v.status} /></span>
            <div className="rt"><h3>{q.title}</h3><div className="src">Tender page {q.source?.page}{q.source?.clause ? `, clause ${q.source.clause}` : ''}{q.mandatory === false ? ', optional' : ''}</div></div>
            <div className="stamp">{L[v.status]}</div>
            <div className="why">{v.reason}
              {v.evidence?.map((e, i) => <div className="ev" key={i}>{doc(e.documentId)}, page {e.page}: {e.note}</div>)}
              {v.needsHumanCheck && <div className="ev">Please verify this one by hand.</div>}
              {v.status !== 'met' && v.fixHint && <div className="fix"><b>Next step</b>{v.fixHint}</div>}</div>
          </article>); })}

        <div className="bar"><h2>Draft cover letter</h2></div>
        <section className="card letter-card"><pre className="letter">{r.coverLetter}</pre></section>
        <div className="row noprint">
          <button onClick={() => window.print()}>Save report as PDF</button>
          <button className="ghost" onClick={copyLetter}>{copied ? 'Copied' : 'Copy cover letter'}</button>
        </div>
        <p className="foot">BidProof helps you check a bid. It does not replace reading the tender or professional advice.</p>
      </div>}
    </main>
  </>);
}