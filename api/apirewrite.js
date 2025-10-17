// /api/apirewrite.js
// Install dependencies: npm install openai

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------------------- Helper functions ----------------------
function addHumanTexture(text) {
  const variations = [
    { regex: /\bHowever\b/g, replace: ["That said", "But", "On the flip side", "Though"] },
    { regex: /\bMoreover\b/g, replace: ["Also", "Plus", "And yeah", "What's more"] },
    { regex: /\bin order to\b/g, replace: ["to", "so I can", "just to"] },
    { regex: /\bIt is important to\b/g, replace: ["You should", "It's key to", "I'd say it's worth"] },
    { regex: /\butilize\b/g, replace: ["use", "tap into", "go with", "make use of"] },
    { regex: /\bthe\b/g, replace: ["that", "the", "a"] },
  ];
  let result = text;
  variations.forEach(({ regex, replace }) => {
    result = result.replace(regex, () => replace[Math.floor(Math.random() * replace.length)]);
  });
  result = result.replace(/\bdo not\b/g, "don't")
                 .replace(/\bis not\b/g, "isn't")
                 .replace(/\bI am\b/g, "I'm");
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

function addImperfections(text) {
  if (Math.random() > 0.4) return text;
  const typos = [
    { from: "the", to: "teh" },
    { from: "and", to: "adn" },
    { from: "to", to: "too" },
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

function cleanInput(s) {
  return (s || "").toString().trim().slice(0, 6000).replace(/[<>]/g, "");
}

// ---------------------- API Handler ----------------------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const rawText = cleanInput(req.body.text);
    const anecdote1 = cleanInput(req.body.anecdote1);
    const anecdote2 = cleanInput(req.body.anecdote2);
    const toneHint = cleanInput(req.body.toneHint) || "friendly, conversational";
    const extraDetail = cleanInput(req.body.extraDetail);

    if (!rawText || !anecdote1 || !anecdote2) {
      return res.status(400).json({ error: "Text and two personal details are required" });
    }

    const prompt = `
You are a creative human editor. Rewrite the text to:
- Sound natural and human.
- Include these personal details subtly: "${anecdote1}", "${anecdote2}".
- Match the tone: ${toneHint}.
- Include additional context if provided: "${extraDetail}".
- Preserve all facts.
- Output only the rewritten text.

Text:
-----
${rawText}
-----
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 1.0,
      max_tokens: 2000,
    });

    let rewritten = (completion.choices?.[0]?.message?.content || "").trim();
    rewritten = splitLongSentences(addHumanTexture(addImperfections(rewritten)));

    const suggestions = [
      "Add a personal opinion on one key point.",
      "Insert a real-life example from your experience.",
      "Vary sentence starters for better flow.",
      "Include a question or rhetorical aside.",
      "Check and adjust any awkward phrasing manually."
    ];

    const disclosure = "This text was refined with an automated assistant. Review and add your own edits for authenticity.";

    res.status(200).json({ rewritten, suggestions, disclosure });

  } catch (err) {
    console.error("Rewrite error:", err);
    res.status(500).json({ error: "Rewrite failed", details: String(err) });
  }
}
