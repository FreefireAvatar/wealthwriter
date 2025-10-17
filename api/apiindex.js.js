// server.js
// Ethical humanizer: enhances text with user-provided details and multi-pass editing for natural voice.
// Install: npm install express cors body-parser openai
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import OpenAI from "openai";

const app = express();

// CORS setup
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));
app.use(bodyParser.json());

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helper: add varied, human-like imperfections
function addHumanTexture(text) {
  const variations = [
    { regex: /\bHowever\b/g, replace: ["That said", "But", "On the flip side", "Though"] },
    { regex: /\bMoreover\b/g, replace: ["Also", "Plus", "And yeah", "What's more"] },
    { regex: /\bin order to\b/g, replace: ["to", "so I can", "just to"] },
    { regex: /\bIt is important to\b/g, replace: ["You should", "It's key to", "I'd say it's worth"] },
    { regex: /\butilize\b/g, replace: ["use", "tap into", "go with", "make use of"] },
    { regex: /\bthe\b/g, replace: ["that", "the", "a"] }, // Occasional swap for casual feel
  ];
  let result = text;
  variations.forEach(({ regex, replace }) => {
    result = result.replace(regex, () => replace[Math.floor(Math.random() * replace.length)]);
  });
  // Add contractions and colloquialisms
  result = result.replace(/\bdo not\b/g, "don't").replace(/\bis not\b/g, "isn't").replace(/\bI am\b/g, "I'm");
  // Randomly add fillers if probability hits
  if (Math.random() > 0.6) {
    const fillers = ["you know,", "like,", "honestly,", "by the way,"];
    const sentences = result.split('. ');
    sentences.forEach((s, i) => {
      if (Math.random() > 0.8) sentences[i] = fillers[Math.floor(Math.random() * fillers.length)] + " " + s;
    });
    result = sentences.join('. ');
  }
  return result;
}

// Helper: add subtle imperfections (typos, etc.)
function addImperfections(text) {
  if (Math.random() > 0.4) return text; // Not always, to avoid overdoing
  const typos = [
    { from: "the", to: "teh" },
    { from: "and", to: "adn" },
    { from: "to", to: "too" }, // Common mix-up
    { from: "it's", to: "its" },
  ];
  let result = text;
  typos.forEach(({ from, to }) => {
    if (Math.random() > 0.7) {
      const regex = new RegExp(`\\b${from}\\b`, 'g');
      result = result.replace(regex, to);
    }
  });
  return result;
}

// Helper: split long sentences
function splitLongSentences(text) {
  return text
    .split(/(?<=\.)\s+/)
    .map(s => {
      if (s.length > 120) {
        const mid = s.lastIndexOf(",", 80);
        if (mid > 20) return s.slice(0, mid) + ". " + s.slice(mid + 1).trim();
        return s.slice(0, 90) + "...";
      }
      return s;
    })
    .join(" ");
}

// Safety: sanitize input
function cleanInput(s) {
  return (s || "").toString().trim().slice(0, 6000).replace(/[<>]/g, "");
}

app.post("/rewrite", async (req, res) => {
  try {
    const rawText = cleanInput(req.body.text);
    const anecdote1 = cleanInput(req.body.anecdote1); // Required personal detail 1
    const anecdote2 = cleanInput(req.body.anecdote2); // Required personal detail 2
    const toneHint = cleanInput(req.body.toneHint) || "friendly, conversational";
    const extraDetail = cleanInput(req.body.extraDetail); // Optional additional context

    if (!rawText || !anecdote1 || !anecdote2) {
      return res.status(400).json({ error: "Text and two personal details are required for better humanization" });
    }

    // PASS 1: Clarity and grammar
    const pass1Prompt = `
You are a meticulous editor. Refine the text for grammar, clarity, and flow:
- Preserve all facts and named entities exactly.
- Make minimal changes; do not add new information.
- Output only the cleaned text.

Text:
-----
${rawText}
-----
`;
    const pass1 = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: pass1Prompt }],
      temperature: 0.4,
      max_tokens: 2000,
    });
    let pass1Text = (pass1.choices?.[0]?.message?.content || "").trim();

    // Apply human texture
    pass1Text = addHumanTexture(pass1Text);

    // PASS 2: Voice and personalization
    const personalizationInstruction = `
Personal details to weave in naturally (use both subtly):
1. "${anecdote1}"
2. "${anecdote2}"
${extraDetail ? `Additional context: "${extraDetail}"` : ""}
Do not invent anything else.
`;
    const pass2Prompt = `
You are a creative writer mimicking human style. Rewrite the text to:
- Sound like a real person: vary sentence lengths, use contractions, add natural asides (e.g., "honestly," "you know").
- Include subtle imperfections like informal phrasing or slight tangents.
- Preserve all facts and named entities.
- Incorporate the provided personal details naturally.
- Match the tone: ${toneHint}.
- Output only the rewritten text.

${personalizationInstruction}
Text:
-----
${pass1Text}
-----
`;
    const pass2 = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: pass2Prompt }],
      temperature: 1.0,
      presence_penalty: 0.8,
      frequency_penalty: 0.6,
      max_tokens: 2000,
    });
    let pass2Text = (pass2.choices?.[0]?.message?.content || "").trim();

    // PASS 3: Final humanization with imperfections
    const pass3Prompt = `
You are a human editor adding authentic flair. Refine the text to:
- Introduce mild human quirks: occasional informal words, varied pacing, or subtle opinion injections (without changing facts).
- Make it feel lived-in, like a draft from someone thinking aloud.
- Preserve all facts and named entities.
- Enhance the tone: ${toneHint}.
- Output only the rewritten text.

Text:
-----
${pass2Text}
-----
`;
    const pass3 = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: pass3Prompt }],
      temperature: 1.1,
      presence_penalty: 0.9,
      frequency_penalty: 0.7,
      max_tokens: 2000,
    });
    let finalText = (pass3.choices?.[0]?.message?.content || "").trim();

    // Post-process: split sentences, add texture and imperfections
    finalText = splitLongSentences(addHumanTexture(finalText));
    finalText = addImperfections(finalText);

    // Suggestions for further personalization
    const suggestionsPrompt = `
You are an ethical editor. Suggest 5 concise ways the author can manually add authentic details or tweaks to this text (e.g., add opinions, fix typos).
Return a JSON array of 5 strings.
Text:
-----
${finalText}
-----
`;
    const suggestionResp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: suggestionsPrompt }],
      temperature: 0.9,
      max_tokens: 300,
    });

    let suggestions = [];
    try {
      suggestions = JSON.parse(suggestionResp.choices?.[0]?.message?.content || "[]");
      if (!Array.isArray(suggestions)) throw new Error("Not an array");
    } catch {
      suggestions = [
        "Add a personal opinion on one key point.",
        "Insert a real-life example from your experience.",
        "Vary sentence starters for better flow.",
        "Include a question or rhetorical aside.",
        "Check and adjust any awkward phrasing manually."
      ];
    }

    const disclosure = "This text was refined with an automated assistant to add voice and clarity. For integrity, manually review and add your own edits before use—detectors like Turnitin value authentic input over perfection.";

    res.json({ rewritten: finalText, suggestions, disclosure });
  } catch (err) {
    console.error("Rewrite error:", err);
    res.status(500).json({ error: "Rewrite failed", details: String(err) });
  }
});

export default app;