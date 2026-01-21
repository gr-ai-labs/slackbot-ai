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
  runtime: "edge",
};

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error("SLACK_SIGNING_SECRET is not configured");
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-slack-signature");
  const timestamp = req.headers.get("x-slack-request-timestamp");

  if (!(await verifySlackRequest(signingSecret, signature, timestamp, rawBody))) {
    return new Response(JSON.stringify({ error: "Invalid request signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = parseSlashCommandPayload(rawBody);

  if (!payload.text || payload.text.trim() === "") {
    return new Response(
      JSON.stringify(createErrorResponse("Please provide a message to reword. Usage: `/reword <your message>`")),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const originalMessage = payload.text.trim();
  const responseUrl = payload.response_url;

  // Process AI request in background and post result to response_url
  waitUntil(
    (async () => {
      try {
        const gateway = createGateway({
          apiKey: process.env.AI_GATEWAY_API_KEY,
        });

        const { text: rewordedMessage } = await generateText({
          model: gateway("anthropic/claude-3-haiku-20240307"),
          system: REWORD_SYSTEM_PROMPT,
          prompt: createRewordUserPrompt(originalMessage),
        });

        await postToResponseUrl(responseUrl, createSlackResponse(originalMessage, rewordedMessage));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("Error calling Claude:", errorMessage, error);
        await postToResponseUrl(responseUrl, createErrorResponse(`Error: ${errorMessage}`));
      }
    })()
  );

  // Immediately return acknowledgment to Slack
  return new Response(
    JSON.stringify({
      response_type: "ephemeral",
      text: ":hourglass_flowing_sand: Rewording your message...",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
