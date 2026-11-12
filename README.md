# BidProof

Upload a tender PDF and your company documents. BidProof extracts every requirement, checks your documents against them with a cited verdict (Met / Weak / Missing), scores your readiness, and drafts a cover letter.

**Why it is reliable:** the AI only *extracts* values and cites pages. Numeric comparisons, expiry checks, and the readiness score are computed in code.

## Run locally
```bash
npm run install:all
cp server/.env.example server/.env   # add ANTHROPIC_API_KEY (MONGO_URI optional)
npm run dev:server                   # terminal 1, port 5000
npm run dev:client                   # terminal 2, http://localhost:5173
```

## Deploy
- **Backend (Render/Railway):** root `server`, build `npm install`, start `npm start`, set env vars from `.env.example`.
- **Frontend (Vercel):** root `client`, build `npm run build`, output `dist`, set `VITE_API_URL` to the backend URL.

## Stack
React (Vite), Node/Express, MongoDB (optional history), pdf-parse, Claude API.
Limits: text-based PDFs only (no OCR yet).
