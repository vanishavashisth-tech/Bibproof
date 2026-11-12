import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import pdf from 'pdf-parse';
import mongoose from 'mongoose';

const app = express();
app.use(cors());
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25e6 } });
const MODEL = process.env.MODEL || 'claude-sonnet-4-6';

// Optional persistence: works without MongoDB too.
const mem = [];
let Check = null;
if (process.env.MONGO_URI) {
  await mongoose.connect(process.env.MONGO_URI);
  Check = mongoose.model('Check', new mongoose.Schema({ data: {}, createdAt: { type: Date, default: Date.now } }));
}

async function llm(system, user, max = 8000) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: max,
      system: system + '\nReturn ONLY valid JSON. No prose, no code fences. Use null when unknown. Never invent facts.',
      messages: [{ role: 'user', content: user }],
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || 'AI request failed');
  const t = d.content.map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
  try { return JSON.parse(t); } catch { throw new Error('AI returned invalid JSON, please retry'); }
}

async function pages(buf) {
  const out = [];
  await pdf(buf, { pagerender: async p => { const c = await p.getTextContent(); const s = c.items.map(i => i.str).join(' '); out.push(s); return s; } });
  return out;
}
const tag = (ps, max) => ps.map((t, i) => `[Page ${i + 1}] ${t}`).join('\n').slice(0, max);

const REQ_SYS = `You read an Indian government/PSU tender. Extract every bidder eligibility/submission requirement stated in the text (financial, experience, registration, document, technical, deadline, fee). Never add requirements not in the text.
Output {"requirements":[{"id":"REQ-001","category":"financial|experience|registration|document|technical|deadline|fee|other","title":"short","description":"one sentence","mandatory":true,"threshold":{"type":"amount|count|years|boolean|date|text|none","operator":">=|<=|=|none","value":null,"unit":null},"period":null,"source":{"page":1,"clause":null,"quote":"max 25 words"}}]}. Amounts in plain INR numbers.`;

const DOC_SYS = `You receive a contractor's uploaded documents (text with [Page N] markers). For each output {"documents":[{"id":"DOC-1","filename":"","docType":"gst_certificate|pan|balance_sheet|turnover_certificate|work_order|completion_certificate|registration|emd_proof|iso_certificate|other","issuer":null,"issueDate":"YYYY-MM-DD|null","validUntil":"YYYY-MM-DD|null","extracted":{"summary":"one line","keyValues":{}},"confidence":0.0}]}. Amounts as plain numbers (INR). Keep ids as given.`;

const MATCH_SYS = `You check a contractor's documents against tender requirements, plus write a cover letter. Output {"verdicts":[{"requirementId":"","status":"met|weak|missing","severity":"blocker|major|minor","reason":"plain-language, cite numbers","evidence":[{"documentId":"","page":1,"note":""}],"observedValue":null,"fixHint":"practical next step","needsHumanCheck":false}],"coverLetter":"formal letter to the tendering authority, placeholders in [brackets] for unknown details"}.
Rules: one verdict per requirement. met/weak need evidence. "met" only if clearly satisfied; prefer weak + needsHumanCheck when unsure. For numeric requirements set observedValue to the number you found (average where the requirement says average); do not decide pass/fail yourself. Blocker = mandatory and likely to cause rejection.`;

function finalize(reqs, docs, out) {
  const rmap = Object.fromEntries(reqs.map(r => [r.id, r]));
  const dmap = Object.fromEntries(docs.map(d => [d.id, d]));
  const today = new Date().toISOString().slice(0, 10);
  const verdicts = reqs.map(r => {
    const v = out.verdicts.find(x => x.requirementId === r.id) || { requirementId: r.id, status: 'missing', severity: 'major', reason: 'No matching document found.', evidence: [], fixHint: 'Upload the relevant document.' };
    v.evidence = v.evidence || [];
    const t = r.threshold;
    if (t && ['amount', 'count', 'years'].includes(t.type) && typeof t.value === 'number' && typeof v.observedValue === 'number' && v.status !== 'missing') {
      const o = v.observedValue;
      const ok = t.operator === '<=' ? o <= t.value : t.operator === '=' ? o === t.value : o >= t.value;
      if (ok) v.status = 'met';
      else { v.status = 'weak'; v.reason += ` (Checked: found ${o.toLocaleString('en-IN')} vs required ${t.operator} ${t.value.toLocaleString('en-IN')}.)`; }
    }
    const expired = v.evidence.map(e => dmap[e.documentId]).filter(d => d?.validUntil && d.validUntil < today);
    if (expired.length && v.status === 'met') { v.status = 'weak'; v.reason += ` Expired document: ${expired.map(d => d.filename).join(', ')}.`; }
    if (v.status !== 'missing' && !v.evidence.length) { v.status = 'weak'; v.needsHumanCheck = true; }
    return v;
  });
  let earned = 0, total = 0;
  verdicts.forEach(v => { const w = rmap[v.requirementId]?.mandatory === false ? 1 : 3; total += w; earned += w * (v.status === 'met' ? 1 : v.status === 'weak' ? 0.5 : 0); });
  let score = total ? Math.round((earned / total) * 100) : 0;
  const blockers = verdicts.filter(v => v.status !== 'met' && v.severity === 'blocker' && rmap[v.requirementId]?.mandatory !== false).length;
  if (blockers) score = Math.min(score, 60);
  const counts = { met: 0, weak: 0, missing: 0, blockers };
  verdicts.forEach(v => counts[v.status]++);
  return { requirements: reqs, documents: docs, verdicts, score, counts, notReady: blockers > 0, coverLetter: out.coverLetter };
}

app.post('/api/analyze', upload.fields([{ name: 'tender', maxCount: 1 }, { name: 'documents', maxCount: 10 }]), async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('Server is missing ANTHROPIC_API_KEY.');
    const t = req.files?.tender?.[0];
    const files = req.files?.documents || [];
    if (!t || !files.length) return res.status(400).json({ error: 'Upload one tender PDF and at least one company document.' });
    const { requirements } = await llm(REQ_SYS, tag(await pages(t.buffer), 70000), 8000);
    if (!requirements?.length) throw new Error('No requirements found. Is the tender a text-based PDF (not a scan)?');
    const raw = [];
    for (const [i, f] of files.entries()) raw.push({ id: `DOC-${i + 1}`, filename: f.originalname, text: tag(await pages(f.buffer), 9000) });
    const { documents } = await llm(DOC_SYS, JSON.stringify(raw), 4000);
    documents.forEach((d, i) => { d.id = raw[i]?.id || d.id; d.filename = raw[i]?.filename || d.filename; });
    const out = await llm(MATCH_SYS, JSON.stringify({ requirements, documents: raw.map(r => ({ ...r, text: r.text.slice(0, 5000) })), documentSummaries: documents }), 8000);
    const result = finalize(requirements, documents, out);
    result.tenderName = t.originalname;
    if (Check) await Check.create({ data: result }); else mem.unshift(result);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/checks', async (_q, res) => res.json(Check ? (await Check.find().sort({ createdAt: -1 }).limit(20)).map(c => c.data) : mem.slice(0, 20)));
app.get('/', (_req, res) => res.send('Welcome to BidProof - Server is running'));

app.get('/api/health', (_q, res) => res.json({ ok: true }));
app.listen(process.env.PORT || 5000, () => console.log('BidProof API up'));
