import { generateText, createGateway } from "ai";
import {
  verifySlackRequest,
  parseSlashCommandPayload,
  createSlackResponse,
  createErrorResponse,
} from "../../lib/slack.js";
import { REWORD_SYSTEM_PROMPT, createRewordUserPrompt } from "../../lib/prompts.js";

export const config = {
  runtime: "edge",
};

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
    log("posted", { status: res.status, ok: res.ok });
  } catch (err) {
    log("post_error", { error: String(err) });
  }
}

export default async function handler(req: Request, context?: { waitUntil?: (p: Promise<unknown>) => void }) {
  const id = crypto.randomUUID().slice(0, 8);
  log("req", { id, method: req.method });

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    log("no_secret", { id });
    return Response.json({ error: "Server configuration error" }, { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-slack-signature");
  const timestamp = req.headers.get("x-slack-request-timestamp");

  if (!(await verifySlackRequest(signingSecret, signature, timestamp, rawBody))) {
    log("bad_sig", { id });
    return Response.json({ error: "Invalid request signature" }, { status: 401 });
  }

  const payload = parseSlashCommandPayload(rawBody);
  log("parsed", { id, text: payload.text?.slice(0, 30), hasUrl: !!payload.response_url });

  if (!payload.text || payload.text.trim() === "") {
    return Response.json(
      createErrorResponse("Please provide a message to reword. Usage: `/reword <your message>`"),
      { status: 200 }
    );
  }

  const originalMessage = payload.text.trim();
  const responseUrl = payload.response_url;

  // Background task
  const task = (async () => {
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

  // Use context.waitUntil if available (Vercel Edge), otherwise fire-and-forget
  if (context?.waitUntil) {
    log("using_waitUntil", { id });
    context.waitUntil(task);
  } else {
    log("fire_and_forget", { id });
    // Fire and forget - don't await
    task.catch(err => log("task_error", { id, error: String(err) }));
  }

  log("ack", { id });
  return Response.json({
    response_type: "ephemeral",
    text: ":hourglass_flowing_sand: Rewording your message...",
  });
}
