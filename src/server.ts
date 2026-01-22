import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { generateText, createGateway } from "ai";
import {
  verifySlackRequest,
  parseSlashCommandPayload,
  createDualVersionResponse,
  createErrorResponse,
  RewordedVersions,
} from "../lib/slack.js";
import {
  REWORD_CASUAL_PROMPT,
  REWORD_FORMAL_PROMPT,
  createRewordUserPrompt,
} from "../lib/prompts.js";

const app = new Hono();

// Threshold for choosing model: short messages use Sonnet, long use Opus
const SHORT_MESSAGE_THRESHOLD = 50;

function log(stage: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), stage, ...data }));
}

async function postToResponseUrl(responseUrl: string, body: object): Promise<void> {
  log("posting", { url: responseUrl.slice(0, 50) });
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

function selectModel(messageLength: number): string {
  // Use Sonnet for short messages (faster), Opus for complex ones (better quality)
  if (messageLength < SHORT_MESSAGE_THRESHOLD) {
    return "anthropic/claude-sonnet-4-20250514";
  }
  return "anthropic/claude-opus-4-20250514";
}

async function generateRewordedVersions(
  gateway: ReturnType<typeof createGateway>,
  model: string,
  message: string
): Promise<RewordedVersions> {
  // Generate both versions in parallel
  const [casualResult, formalResult] = await Promise.all([
    generateText({
      model: gateway(model),
      system: REWORD_CASUAL_PROMPT,
      prompt: createRewordUserPrompt(message),
    }),
    generateText({
      model: gateway(model),
      system: REWORD_FORMAL_PROMPT,
      prompt: createRewordUserPrompt(message),
    }),
  ]);

  return {
    casual: casualResult.text,
    formal: formalResult.text,
  };
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

  // Process in background
  (async () => {
    log("bg_start", { id });
    try {
      const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY });
      const model = selectModel(originalMessage.length);
      log("ai_call", { id, model, msgLen: originalMessage.length });
      const t0 = Date.now();

      const versions = await generateRewordedVersions(gateway, model, originalMessage);

      log("ai_done", { id, ms: Date.now() - t0 });
      await postToResponseUrl(responseUrl, createDualVersionResponse(originalMessage, versions));
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

// Slack message shortcut handler
app.post("/api/slack/shortcut", async (c) => {
  const id = crypto.randomUUID().slice(0, 8);
  log("shortcut_req", { id });

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

  // Parse the payload (it's URL encoded with a 'payload' field containing JSON)
  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get("payload");
  if (!payloadStr) {
    log("no_payload", { id });
    return c.json({ error: "Missing payload" }, 400);
  }

  const payload = JSON.parse(payloadStr);
  log("shortcut_parsed", { id, type: payload.type, callbackId: payload.callback_id });

  // Handle message shortcut
  if (payload.type === "message_action" || payload.type === "shortcut") {
    const messageText = payload.message?.text || payload.text || "";
    const responseUrl = payload.response_url;

    if (!messageText) {
      return c.json({
        response_type: "ephemeral",
        text: ":warning: Could not extract message text.",
      });
    }

    // Process in background
    (async () => {
      log("shortcut_bg_start", { id });
      try {
        const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY });
        const model = selectModel(messageText.length);
        log("shortcut_ai_call", { id, model });
        const t0 = Date.now();

        const versions = await generateRewordedVersions(gateway, model, messageText);

        log("shortcut_ai_done", { id, ms: Date.now() - t0 });
        await postToResponseUrl(responseUrl, createDualVersionResponse(messageText, versions));
        log("shortcut_bg_done", { id });
      } catch (err) {
        log("shortcut_bg_err", { id, error: String(err) });
        await postToResponseUrl(responseUrl, createErrorResponse(`Error: ${err}`));
      }
    })();

    return c.json({
      response_type: "ephemeral",
      text: ":hourglass_flowing_sand: Rewording message...",
    });
  }

  // Handle interactive button clicks (copy buttons)
  if (payload.type === "block_actions") {
    const action = payload.actions?.[0];
    if (action?.action_id?.startsWith("copy_")) {
      // The copy action - show the text to user so they can copy it
      const textToCopy = action.value;
      return c.json({
        response_type: "ephemeral",
        replace_original: false,
        text: `📋 *Ready to copy:*\n\n${textToCopy}\n\n_Select the text above and copy it._`,
      });
    }
  }

  return c.json({ ok: true });
});

// Slack interactivity endpoint (for button clicks)
app.post("/api/slack/interactive", async (c) => {
  const id = crypto.randomUUID().slice(0, 8);
  log("interactive_req", { id });

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    return c.json({ error: "Server configuration error" }, 500);
  }

  const rawBody = await c.req.text();
  const signature = c.req.header("x-slack-signature");
  const timestamp = c.req.header("x-slack-request-timestamp");

  if (!(await verifySlackRequest(signingSecret, signature ?? null, timestamp ?? null, rawBody))) {
    return c.json({ error: "Invalid request signature" }, 401);
  }

  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get("payload");
  if (!payloadStr) {
    return c.json({ error: "Missing payload" }, 400);
  }

  const payload = JSON.parse(payloadStr);
  log("interactive_parsed", { id, type: payload.type });

  // Handle button clicks
  if (payload.type === "block_actions") {
    const action = payload.actions?.[0];
    if (action?.action_id?.startsWith("copy_")) {
      const textToCopy = action.value;
      return c.json({
        response_type: "ephemeral",
        replace_original: false,
        text: `📋 *Ready to copy:*\n\n\`\`\`${textToCopy}\`\`\`\n\n_Select and copy the text above._`,
      });
    }
  }

  return c.json({ ok: true });
});

const port = parseInt(process.env.PORT || "3000", 10);

console.log(`Starting server on port ${port}...`);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server running at http://localhost:${info.port}`);
});
