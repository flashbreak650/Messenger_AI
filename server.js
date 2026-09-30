import "dotenv/config";
import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const {
  PAGE_ACCESS_TOKEN,
  VERIFY_TOKEN,
  AI_API_KEY,
  GRAPH_API_VERSION
} = process.env;

const required = [
  "PAGE_ACCESS_TOKEN",
  "VERIFY_TOKEN",
  "AI_API_KEY",
  "GRAPH_API_VERSION"
];

for (const name of required) {
  if (!process.env[name]) {
    console.error(`Missing environment variable: ${name}`);
    process.exit(1);
  }
}

const openai = new OpenAI({ apiKey: AI_API_KEY });

function log(message, data = {}) {
  console.log(JSON.stringify({
    time: new Date().toISOString(),
    message,
    ...data
  }));
}

function logError(message, error, data = {}) {
  console.error(JSON.stringify({
    time: new Date().toISOString(),
    level: "error",
    message,
    error: error?.message || String(error),
    ...data
  }));
}

app.get("/", (_req, res) => {
  res.sendFile("index.html", { root: "./public" });
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (!mode || !token || !challenge) {
    return res.status(400).send("Missing verification parameters");
  }

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    log("Facebook webhook verified");
    return res.status(200).send(challenge);
  }

  return res.status(403).send("Forbidden");
});

app.post("/webhook", (req, res) => {
  res.sendStatus(200);

  processWebhook(req.body).catch((error) => {
    logError("Webhook processing failed", error);
  });
});

async function processWebhook(body) {
  if (body?.object !== "page") return;

  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      await processMessage(event);
    }
  }
}

async function processMessage(event) {
  const senderId = event?.sender?.id;

  if (!senderId) return;

  if (event?.message?.is_echo === true) {
    log("Ignoring echo/self message");
    return;
  }

  if (event.delivery || event.read) return;

  const text = event?.message?.text;

  if (typeof text !== "string" || !text.trim()) return;

  const userMessage = text.trim();

  log("Customer message received", {
    senderId,
    length: userMessage.length
  });

  try {
    const answer = await generateAIResponse(userMessage);
    await sendFacebookMessage(senderId, answer);

    log("AI response sent", { senderId });

    // Future admin notification:
    // await notifyAdmin({ senderId, userMessage, answer });
  } catch (error) {
    logError("Message processing failed", error, { senderId });

    try {
      await sendFacebookMessage(
        senderId,
        "দুঃখিত, এই মুহূর্তে উত্তর দিতে সমস্যা হচ্ছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।"
      );
    } catch (fallbackError) {
      logError("Fallback message failed", fallbackError, { senderId });
    }
  }
}

async function generateAIResponse(userMessage) {
  const response = await openai.responses.create({
    model: "gpt-5.6-luna",
    instructions: `
তুমি একটি Facebook Messenger AI customer-support assistant।

নিয়ম:
- স্বাভাবিক, ভদ্র ও সহজ বাংলায় উত্তর দাও।
- ব্যবহারকারীর প্রশ্নের সরাসরি উত্তর দাও।
- তথ্য জানা না থাকলে বানিয়ে বলবে না।
- নিশ্চিত না হলে সেটা পরিষ্কারভাবে জানাবে।
- অপ্রয়োজনীয়ভাবে দীর্ঘ উত্তর দেবে না।
- ব্যবহারকারী ইংরেজিতে লিখলে প্রয়োজন অনুযায়ী বাংলায় উত্তর দিতে পারো।
- কোনো API key, token, password বা গোপন তথ্য প্রকাশ করবে না।
- তোমার কাছে নেই এমন business information বানিয়ে বলবে না।
`,
    input: userMessage,
    max_output_tokens: 500
  });

  const answer = response.output_text?.trim();

  if (!answer) {
    throw new Error("AI returned empty response");
  }

  return answer;
}

async function sendFacebookMessage(recipientId, message) {
  const url =
    `https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: message },
      access_token: PAGE_ACCESS_TOKEN
    })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      `Facebook API error ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((error, _req, res, _next) => {
  logError("Unhandled server error", error);

  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, () => {
  log("Messenger AI server started", { port: PORT });
});