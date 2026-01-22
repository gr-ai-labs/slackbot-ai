import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { generateText, createGateway } from "ai";
import {
  verifySlackRequest,
  parseSlashCommandPayload,
  createSlackResponse,
  createErrorResponse,
} from "../lib/slack.js";
import { REWORD_SYSTEM_PROMPT, createRewordUserPrompt } from "../lib/prompts.js";

const app = new Hono();

function log(stage: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), stage, ...data }));
}

async function postToResponseUrl(responseUrl: string, body: object): Promise<void> {
  log("posting", { url: responseUrl.slice(0, 50), body: JSON.stringify(body).slice(0, 200) });
  try {
    const res = await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const responseText = await res.text();
    log("posted", { status: res.status, ok: res.ok, response: responseText.slice(0, 200) });
  } catch (err) {
    log("post_error", { error: String(err) });
  }
}

// Health check endpoint
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Root endpoint
app.get("/", (c) => {
  return c.json({ service: "slackbot-ai", status: "running" });
});

// Slack reword command
app.post("/api/slack/reword", async (c) => {
  const id = crypto.randomUUID().slice(0, 8);
  log("req", { id });

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    log("no_secret", { id });
    return c.json({ error: "Server configuration error" }, 500);
  }

  const rawBody = await c.req.text();
  const signature = c.req.header("x-slack-signature");
  const timestamp = c.req.header("x-slack-request-timestamp");

  if (!(await verifySlackRequest(signingSecret, signature ?? null, timestamp ?? null, rawBody))) {
    log("bad_sig", { id });
    return c.json({ error: "Invalid request signature" }, 401);
  }

  const payload = parseSlashCommandPayload(rawBody);
  log("parsed", { id, text: payload.text?.slice(0, 30), hasUrl: !!payload.response_url });

  if (!payload.text || payload.text.trim() === "") {
    return c.json(
      createErrorResponse("Please provide a message to reword. Usage: `/reword <your message>`"),
      200
    );
  }

  const originalMessage = payload.text.trim();
  const responseUrl = payload.response_url;

  // Process in background (fire-and-forget, no cold start on Railway)
  (async () => {
    log("bg_start", { id });
    try {
      const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY });
      log("ai_call", { id });
      const t0 = Date.now();

      const { text: rewordedMessage } = await generateText({
        model: gateway("anthropic/claude-sonnet-4-20250514"),
        system: REWORD_SYSTEM_PROMPT,
        prompt: createRewordUserPrompt(originalMessage),
      });

      log("ai_done", { id, ms: Date.now() - t0 });
      await postToResponseUrl(responseUrl, createSlackResponse(originalMessage, rewordedMessage));
      log("bg_done", { id });
    } catch (err) {
      log("bg_err", { id, error: String(err) });
      await postToResponseUrl(responseUrl, createErrorResponse(`Error: ${err}`));
    }
  })();

  log("ack", { id });
  return c.json({
    response_type: "ephemeral",
    text: ":hourglass_flowing_sand: Rewording your message...",
  });
});

const port = parseInt(process.env.PORT || "3000", 10);

console.log(`Starting server on port ${port}...`);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server running at http://localhost:${info.port}`);
});
