import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import "dotenv/config";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.get("/session", async (req, res) => {
  try {
    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        voice: "alloy",
        instructions:
`You are a realtime voice assistant. Speak concisely.
Also produce a sidebar JSON object:
{
  "assistant_text": "markdown summary",
  "code": {"language":"", "snippet":""},
  "visual": {"type":"dot","code":"digraph G {A->B}"}
}
Only include fields when useful.`
      }),
    });

    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`Ephemeral server running at http://localhost:${PORT}`);
});
