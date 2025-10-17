// /api/apirewrite.js
import OpenAI from "openai";

// Initialize OpenAI client with error handling
let client;
try {
  client = new OpenAI({ 
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 30000 // 30 second timeout
  });
} catch (error) {
  console.error("Failed to initialize OpenAI client:", error);
}

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
      if (Math.random() > 0.8) {
        sentences[i] = fillers[Math.floor(Math.random() * fillers.length)] + " " + s;
      }
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
  // Set CORS headers for better compatibility
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ 
      error: "Method not allowed",
      allowed: "POST"
    });
  }

  // Check for OpenAI client
  if (!client) {
    return res.status(500).json({ 
      error: "Service unavailable",
      details: "OpenAI client not initialized"
    });
  }

  // Check API key
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY environment variable is missing");
    return res.status(500).json({ 
      error: "Configuration error",
      details: "API key not configured"
    });
  }

  try {
    // Parse request body with better error handling
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      return res.status(400).json({ 
        error: "Invalid JSON in request body" 
      });
    }

    const rawText = cleanInput(body.text);
    const anecdote1 = cleanInput(body.anecdote1);
    const anecdote2 = cleanInput(body.anecdote2);
    const toneHint = cleanInput(body.toneHint) || "friendly, conversational";
    const extraDetail = cleanInput(body.extraDetail);

    if (!rawText || !anecdote1 || !anecdote2) {
      return res.status(400).json({ 
        error: "Text and two personal details are required",
        received: { hasText: !!rawText, hasAnecdote1: !!anecdote1, hasAnecdote2: !!anecdote2 }
      });
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

    console.log("Sending request to OpenAI...");

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 1.0,
      max_tokens: 2000,
      timeout: 30000, // Add timeout
    });

    let rewritten = (completion.choices?.[0]?.message?.content || "").trim();
    
    if (!rewritten) {
      return res.status(500).json({ 
        error: "No response from OpenAI",
        completion: completion
      });
    }

    rewritten = splitLongSentences(addHumanTexture(addImperfections(rewritten)));

    const suggestions = [
      "Add a personal opinion on one key point.",
      "Insert a real-life example from your experience.",
      "Vary sentence starters for better flow.",
      "Include a question or rhetorical aside.",
      "Check and adjust any awkward phrasing manually."
    ];

    const disclosure = "This text was refined with an automated assistant. Review and add your own edits for authenticity.";

    console.log("Successfully processed request");
    
    res.status(200).json({ 
      rewritten, 
      suggestions, 
      disclosure,
      wordCount: rewritten.split(' ').length
    });

  } catch (err) {
    console.error("Rewrite error:", err);
    
    // Handle specific OpenAI errors
    if (err.status === 401) {
      return res.status(401).json({ 
        error: "Invalid API key",
        details: "Please check your OpenAI API key"
      });
    }
    
    if (err.status === 429) {
      return res.status(429).json({ 
        error: "Rate limit exceeded",
        details: "Too many requests. Please try again later"
      });
    }
    
    if (err.status >= 500) {
      return res.status(503).json({ 
        error: "OpenAI service unavailable",
        details: "Please try again later"
      });
    }

    res.status(500).json({ 
      error: "Rewrite failed",
      details: err.message || String(err),
      code: err.code
    });
  }
}

// For Vercel/Next.js edge runtime compatibility
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // Increase body size limit
    },
  },
  runtime: 'nodejs', // Ensure Node.js runtime
};
