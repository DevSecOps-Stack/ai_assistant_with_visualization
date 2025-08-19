import Prism from "prismjs";
import "prismjs/themes/prism-tomorrow.css";
import "prismjs/components/prism-python";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-bash";

import React, { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { instance } from "@viz-js/viz";

type SidebarBundle = {
  assistant_text: string;
  code?: { language: string; snippet: string };
  visual?: { type: "dot"; code: string };
};

export default function App() {
  const [status, setStatus] = useState("Idle");
  const [connected, setConnected] = useState(false);
  const [assistantText, setAssistantText] = useState<string>("");
  const [codeLang, setCodeLang] = useState<string>("");
  const [codeSnippet, setCodeSnippet] = useState<string>("");
  const [visualSVG, setVisualSVG] = useState<string>("");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioEl = useRef<HTMLAudioElement>(null);
  const vizRef = useRef<any>(null);

  const start = async () => {
    setStatus("Connecting…");

    const r = await fetch("http://localhost:5050/session");
    if (!r.ok) { setStatus("Failed to get ephemeral key"); return; }
    const data = await r.json();
    const EPHEMERAL = data?.client_secret?.value;
    if (!EPHEMERAL) { setStatus("No ephemeral key in response"); return; }

    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    pc.ontrack = (ev) => { if (audioEl.current) audioEl.current.srcObject = ev.streams[0]; };

// ❌ remove this line:
// const dc = pc.createDataChannel("oai-events");

// ✅ listen for the REMOTE data channel from the model
pc.ondatachannel = (event) => {
  const dc = event.channel;
  dcRef.current = dc;

  dc.onopen = () => {
    // Ask the model to speak AND emit the sidebar JSON once the channel is ready
    requestSidebarJSON(dc);
  };

  dc.onmessage = (ev) => {
    // Some frames may be ArrayBuffer. We only handle text here.
    if (typeof ev.data !== "string") return;

    // Debug: see exactly what the model is sending
    console.debug("[RT DC]", ev.data);

    let msg: any;
    try { msg = JSON.parse(ev.data); } catch { return; }

    // --- Common streaming shapes ---

    // 1) Text deltas
    if (
      (msg.type === "response.output_text.delta" && typeof msg.delta === "string") ||
      (msg.delta && typeof msg.delta === "string") // fallback
    ) {
      setAssistantText((prev) => prev + msg.delta);
      return;
    }

    // 2) Completed with a plain `output_text` (often our JSON bundle is here)
    if (msg.type === "response.completed" && msg.response) {
      // Try common fields first
      let raw = msg.response.output_text
             || msg.response.text
             || "";

      // Fallback: walk `response.output` array (some SDKs use this)
      if (!raw && Array.isArray(msg.response.output)) {
        try {
          const parts = msg.response.output
            .flatMap((o: any) => (Array.isArray(o.content) ? o.content : []))
            .filter((c: any) => c.type === "output_text")
            .map((c: any) => c.text);
          raw = parts.join("") || "";
        } catch {}
      }

      if (raw) {
        try {
          const parsed: SidebarBundle = JSON.parse(raw);
          renderSidebar(parsed);
        } catch {
          // Not JSON? Treat as plain assistant text.
          setAssistantText((prev) => prev ? prev + "\n" + raw : raw);
        }
      }
      return;
    }

    // 3) Refusals / notices
    if (msg.type === "response.refusal") {
      setAssistantText("The model refused that request.");
      return;
    }
  };
};

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStreamRef.current = stream;
    stream.getTracks().forEach(t => pc.addTrack(t, stream));

    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);

    const model = "gpt-4o-realtime-preview-2024-12-17";
    const sdpResp = await fetch(`https://api.openai.com/v1/realtime?model=${model}`, {
      method: "POST",
      body: offer.sdp,
      headers: { "Authorization": `Bearer ${EPHEMERAL}`, "Content-Type": "application/sdp" }
    });
    if (!sdpResp.ok) { setStatus("SDP exchange failed"); return; }
    const answer = { type: "answer", sdp: await sdpResp.text() } as RTCSessionDescriptionInit;
    await pc.setRemoteDescription(answer);

    setConnected(true);
    setStatus("Live (WebRTC connected)");

  };

  const end = () => {
    try { dcRef.current?.close(); } catch {}
    try { pcRef.current?.close(); } catch {}
    try { micStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
    dcRef.current = null; pcRef.current = null; micStreamRef.current = null;
    setConnected(false); setStatus("Idle");
  };

  const sendText = (text: string) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    dc.send(JSON.stringify({
      type: "response.create",
      response: { modalities: ["audio","text"], instructions: text }
    }));
  };

  const requestSidebarJSON = (dc: RTCDataChannel | null) => {
    if (!dc || dc.readyState !== "open") return;
    const schema = {
      type: "json_schema",
      json_schema: {
        name: "SideBarBundle",
        strict: true,
        schema: {
          type: "object",
          properties: {
            assistant_text: { type: "string" },
            code: {
              type: "object",
              properties: {
                language: { type: "string" },
                snippet: { type: "string" }
              },
              required: ["language","snippet"],
              additionalProperties: false
            },
            visual: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["dot"] },
                code: { type: "string" }
              },
              required: ["type","code"],
              additionalProperties: false
            }
          },
          required: ["assistant_text"],
          additionalProperties: false
        }
      }
    };
    dc.send(JSON.stringify({
      type: "response.create",
      response: {
        modalities: ["audio","text"],
        response_format: schema,
        instructions: "Speak aloud a concise response and also emit the JSON sidebar bundle matching the schema."
      }
    }));
  };

  const renderSidebar = async (b: SidebarBundle) => {
    setAssistantText(b.assistant_text || "");
    if (b.code) {
      setCodeLang(b.code.language || "");
      setCodeSnippet(b.code.snippet || "");
      setTimeout(() => Prism.highlightAll(), 0);
    } else {
      setCodeLang(""); setCodeSnippet("");
    }

    if (b.visual?.type === "dot" && b.visual.code) {
      try {
        const viz = await instance();
        const svg = viz.renderString(b.visual.code, { format: "svg" });
        setVisualSVG(svg);
      } catch {
        setVisualSVG("<em>DOT render failed.</em>");
      }
    } else {
      setVisualSVG("");
    }
  };

  return (
    <div className="wrap">
      <header>
        <div className="row">
          <button onClick={start} disabled={connected}>🎙️ Start Live</button>
          <button onClick={end} disabled={!connected}>⏹️ End</button>
          <span className="status">{status}</span>
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); const t = (e.currentTarget.elements.namedItem("typed") as HTMLInputElement).value.trim(); if (t) sendText(t); }}>
          <input name="typed" placeholder="(Optional) type and send a message…" />
          <button type="submit" disabled={!connected}>Send</button>
        </form>
      </header>

      <main>
        <section className="left">
          <p>Speak naturally; you’ll get <b>live audio</b> back. The sidebar updates in real time with markdown, code, and a DOT diagram (if the model provides one).</p>
          <audio ref={audioEl} autoPlay />
        </section>
        <aside className="right">
          <div className="panel">
            <h3>🧾 Assistant</h3>
            <div className="md"><ReactMarkdown>{assistantText || "—"}</ReactMarkdown></div>
          </div>

          <div className="panel">
            <h3>🧩 Code {codeLang ? <em>({codeLang})</em> : null}</h3>
            {codeSnippet ? (
              <pre><code className={`language-${codeLang || "javascript"}`}>{codeSnippet}</code></pre>
            ) : "—"}
          </div>

          <div className="panel">
            <h3>🗺️ Visual</h3>
            <div className="visual" dangerouslySetInnerHTML={{ __html: visualSVG || "—" }} />
          </div>
        </aside>
      </main>
    </div>
  );
}
