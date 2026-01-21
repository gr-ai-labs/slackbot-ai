import { generateText, createGateway } from "ai";
import { waitUntil } from "@vercel/functions";
import {
  verifySlackRequest,
  parseSlashCommandPayload,
  createSlackResponse,
  createErrorResponse,
  type SlackSlashCommandPayload,
} from "../../lib/slack.js";
import { REWORD_SYSTEM_PROMPT, createRewordUserPrompt } from "../../lib/prompts.js";

export const config = {
  runtime: "edge",
};

export default async function handler(req: Request) {
  // Only accept POST requests
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

  // Get raw body for signature verification
  const rawBody = await req.text();

  // Verify the request is from Slack
  const signature = req.headers.get("x-slack-signature");
  const timestamp = req.headers.get("x-slack-request-timestamp");

  if (!(await verifySlackRequest(signingSecret, signature, timestamp, rawBody))) {
    return new Response(JSON.stringify({ error: "Invalid request signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse the slash command payload
  const payload = parseSlashCommandPayload(rawBody);

  // Validate the message
  if (!payload.text || payload.text.trim() === "") {
    return new Response(
      JSON.stringify(createErrorResponse("Please provide a message to reword. Usage: `/reword <your message>`")),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Process asynchronously using Vercel's waitUntil
  // This keeps the function alive after returning the response
  waitUntil(processAndRespond(payload));

  // Return immediate acknowledgment to Slack
  return new Response(
    JSON.stringify({
      response_type: "ephemeral",
      text: "Rewording your message...",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

async function processAndRespond(payload: SlackSlashCommandPayload): Promise<void> {
  const originalMessage = payload.text.trim();

  try {
    // Create gateway with explicit API key
    const gateway = createGateway({
      apiKey: process.env.AI_GATEWAY_API_KEY,
    });

    // Call Claude via Vercel AI Gateway
    const { text: rewordedMessage } = await generateText({
      model: gateway("anthropic/claude-3-5-sonnet-20241022"),
      system: REWORD_SYSTEM_PROMPT,
      prompt: createRewordUserPrompt(originalMessage),
    });

    // Send the reworded message to Slack via response_url
    await fetch(payload.response_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createSlackResponse(originalMessage, rewordedMessage)),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error calling Claude:", errorMessage, error);
    // Send error message to Slack with details for debugging
    await fetch(payload.response_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createErrorResponse(`Error: ${errorMessage}`)),
    });
  }
}
