import { generateText, createGateway } from "ai";
import { waitUntil } from "@vercel/functions";
import {
  verifySlackRequest,
  parseSlashCommandPayload,
  createSlackResponse,
  createErrorResponse,
} from "../../lib/slack.js";
import { REWORD_SYSTEM_PROMPT, createRewordUserPrompt } from "../../lib/prompts.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

function log(stage: string, data?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, stage, ...data }));
}

async function postToResponseUrl(responseUrl: string, body: object): Promise<void> {
  log("posting_to_response_url", { responseUrl: responseUrl.slice(0, 50) });
  const response = await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  log("response_url_result", { status: response.status, ok: response.ok });
  if (!response.ok) {
    const text = await response.text();
    log("response_url_error", { text });
  }
}

export default async function handler(req: Request) {
  const requestId = crypto.randomUUID().slice(0, 8);
  log("request_received", { requestId, method: req.method });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    log("error_no_signing_secret", { requestId });
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-slack-signature");
  const timestamp = req.headers.get("x-slack-request-timestamp");

  if (!(await verifySlackRequest(signingSecret, signature, timestamp, rawBody))) {
    log("signature_invalid", { requestId });
    return new Response(JSON.stringify({ error: "Invalid request signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = parseSlashCommandPayload(rawBody);
  const responseUrl = payload.response_url;
  log("payload_parsed", { requestId, text: payload.text?.slice(0, 50), hasResponseUrl: !!responseUrl });

  if (!payload.text || payload.text.trim() === "") {
    return new Response(
      JSON.stringify(createErrorResponse("Please provide a message to reword. Usage: `/reword <your message>`")),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const originalMessage = payload.text.trim();

  // Start background processing
  log("starting_background", { requestId });

  const backgroundTask = (async () => {
    log("background_started", { requestId });
    try {
      const gateway = createGateway({
        apiKey: process.env.AI_GATEWAY_API_KEY,
      });

      log("calling_ai", { requestId });
      const startTime = Date.now();

      const { text: rewordedMessage } = await generateText({
        model: gateway("anthropic/claude-3-haiku-20240307"),
        system: REWORD_SYSTEM_PROMPT,
        prompt: createRewordUserPrompt(originalMessage),
      });

      const duration = Date.now() - startTime;
      log("ai_success", { requestId, duration });

      await postToResponseUrl(responseUrl, createSlackResponse(originalMessage, rewordedMessage));
      log("background_complete", { requestId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("background_error", { requestId, error: errorMessage });

      try {
        await postToResponseUrl(responseUrl, createErrorResponse(`Error: ${errorMessage}`));
      } catch (postError) {
        log("failed_to_post_error", { requestId, postError: String(postError) });
      }
    }
  })();

  waitUntil(backgroundTask);
  log("returning_ack", { requestId });

  // Return immediate acknowledgment
  return new Response(
    JSON.stringify({
      response_type: "ephemeral",
      text: ":hourglass_flowing_sand: Rewording your message...",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
