# AI Voice App (React + OpenAI Realtime + WebRTC)

Live voice with a side panel (markdown, code, Graphviz DOT).

## Prereqs
- Node.js 18+
- OpenAI API key with Realtime access

## 1) Server (ephemeral key mint)
```bash
cd server
cp .env.example .env
# Edit .env and set OPENAI_API_KEY
npm install
npm start
# => http://localhost:5050/session
```

## 2) Client (Vite React + TS)
```bash
cd client
npm install
npm run dev
# Open the printed URL (e.g., http://localhost:5173)
```

Keep the server running while you use the client.

### What it does
- WebRTC duplex audio (mic → model, model → live TTS)
- Data channel carries **JSON bundle** for the sidebar:
  - `assistant_text` (markdown)
  - `code.language + code.snippet` (syntax-highlighted)
  - `visual.dot` → SVG (Viz.js)

### Notes
- Server returns a **1-minute ephemeral key**; never expose your permanent key to the browser.
- Adjust `model`/`voice` in `server/server.js` as needed.
- For prod: HTTPS for both apps and tighten CORS.
