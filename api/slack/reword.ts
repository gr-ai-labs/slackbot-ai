import { generateText, createGateway } from "ai";
import { waitUntil } from "@vercel/functions";
import {
  verifySlackRequest,
  parseSlashCommandPayload,
  createSlackResponse,
  createErrorResponse,
  postToResponseUrl,
} from "../../lib/slack.js";
import { REWORD_SYSTEM_PROMPT, createRewordUserPrompt } from "../../lib/prompts.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 30,
};

function log(stage: string, data?: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, stage, ...data }));
}

export default async function handler(req: Request) {
  const requestId = crypto.randomUUID().slice(0, 8);
  log("request_received", { requestId, method: req.method, url: req.url });

  if (req.method !== "POST") {
    log("rejected_method", { requestId, method: req.method });
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const hasGatewayKey = !!process.env.AI_GATEWAY_API_KEY;
  log("env_check", { requestId, hasSigningSecret: !!signingSecret, hasGatewayKey });

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
  log("request_parsed", { requestId, hasSignature: !!signature, hasTimestamp: !!timestamp, bodyLength: rawBody.length });

  if (!(await verifySlackRequest(signingSecret, signature, timestamp, rawBody))) {
    log("signature_invalid", { requestId });
    return new Response(JSON.stringify({ error: "Invalid request signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  log("signature_valid", { requestId });

  const payload = parseSlashCommandPayload(rawBody);
  log("payload_parsed", {
    requestId,
    hasText: !!payload.text,
    textLength: payload.text?.length || 0,
    hasResponseUrl: !!payload.response_url,
    responseUrlPrefix: payload.response_url?.slice(0, 50)
  });

  if (!payload.text || payload.text.trim() === "") {
    log("empty_message", { requestId });
    return new Response(
      JSON.stringify(createErrorResponse("Please provide a message to reword. Usage: `/reword <your message>`")),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const originalMessage = payload.text.trim();
  const responseUrl = payload.response_url;

  log("starting_background_task", { requestId, messageLength: originalMessage.length, responseUrl });

  // Process AI request in background and post result to response_url
  waitUntil(
    (async () => {
      log("background_task_started", { requestId });
      try {
        log("creating_gateway", { requestId });
        const gateway = createGateway({
          apiKey: process.env.AI_GATEWAY_API_KEY,
        });
        log("gateway_created", { requestId });

        log("calling_ai", { requestId, model: "anthropic/claude-3-haiku-20240307" });
        const startTime = Date.now();
        const { text: rewordedMessage } = await generateText({
          model: gateway("anthropic/claude-3-haiku-20240307"),
          system: REWORD_SYSTEM_PROMPT,
          prompt: createRewordUserPrompt(originalMessage),
        });
        const aiDuration = Date.now() - startTime;
        log("ai_response_received", { requestId, aiDuration, responseLength: rewordedMessage.length });

        log("posting_to_response_url", { requestId, responseUrl });
        await postToResponseUrl(responseUrl, createSlackResponse(originalMessage, rewordedMessage));
        log("posted_to_response_url_success", { requestId });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        log("background_task_error", { requestId, errorMessage, errorStack, errorType: error?.constructor?.name });

        try {
          log("posting_error_to_response_url", { requestId });
          await postToResponseUrl(responseUrl, createErrorResponse(`Error: ${errorMessage}`));
          log("posted_error_to_response_url_success", { requestId });
        } catch (postError) {
          const postErrorMessage = postError instanceof Error ? postError.message : String(postError);
          log("failed_to_post_error", { requestId, postErrorMessage });
        }
      }
      log("background_task_completed", { requestId });
    })()
  );

  log("returning_acknowledgment", { requestId });

  // Immediately return acknowledgment to Slack
  return new Response(
    JSON.stringify({
      response_type: "ephemeral",
      text: ":hourglass_flowing_sand: Rewording your message...",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
