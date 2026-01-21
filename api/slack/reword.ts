import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
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

  // Process asynchronously and respond via response_url
  // Use waitUntil to keep the function alive after returning
  const ctx = (globalThis as { waitUntil?: (promise: Promise<unknown>) => void });
  if (ctx.waitUntil) {
    ctx.waitUntil(processAndRespond(payload));
  } else {
    // Fallback: process inline (may timeout for slow responses)
    await processAndRespond(payload);
    return new Response(null, { status: 200 });
  }

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
    // Call Claude via Vercel AI SDK
    const { text: rewordedMessage } = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      system: REWORD_SYSTEM_PROMPT,
      prompt: createRewordUserPrompt(originalMessage),
      maxTokens: 500,
    });

    // Send the reworded message to Slack via response_url
    await fetch(payload.response_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createSlackResponse(originalMessage, rewordedMessage)),
    });
  } catch (error) {
    console.error("Error calling Claude:", error);
    // Send error message to Slack
    await fetch(payload.response_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createErrorResponse("Sorry, I couldn't reword your message. Please try again.")),
    });
  }
}
