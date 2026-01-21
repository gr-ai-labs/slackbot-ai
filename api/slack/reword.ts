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
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, stage, ...data }));
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
  log("payload_parsed", { requestId, text: payload.text?.slice(0, 50) });

  if (!payload.text || payload.text.trim() === "") {
    return new Response(
      JSON.stringify(createErrorResponse("Please provide a message to reword. Usage: `/reword <your message>`")),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const originalMessage = payload.text.trim();

  try {
    log("calling_ai", { requestId });
    const startTime = Date.now();

    const gateway = createGateway({
      apiKey: process.env.AI_GATEWAY_API_KEY,
    });

    const { text: rewordedMessage } = await generateText({
      model: gateway("anthropic/claude-3-haiku-20240307"),
      system: REWORD_SYSTEM_PROMPT,
      prompt: createRewordUserPrompt(originalMessage),
    });

    const duration = Date.now() - startTime;
    log("ai_success", { requestId, duration });

    return new Response(
      JSON.stringify(createSlackResponse(originalMessage, rewordedMessage)),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log("ai_error", { requestId, error: errorMessage });
    return new Response(
      JSON.stringify(createErrorResponse(`Error: ${errorMessage}`)),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
}
