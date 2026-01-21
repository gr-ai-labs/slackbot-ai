import type { VercelRequest, VercelResponse } from "@vercel/node";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import {
  verifySlackRequest,
  parseSlashCommandPayload,
  createSlackResponse,
  createErrorResponse,
} from "../../lib/slack.js";
import { REWORD_SYSTEM_PROMPT, createRewordUserPrompt } from "../../lib/prompts.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error("SLACK_SIGNING_SECRET is not configured");
    return res.status(500).json({ error: "Server configuration error" });
  }

  // Get raw body for signature verification
  const rawBody = await getRawBody(req);

  // Verify the request is from Slack
  const signature = req.headers["x-slack-signature"] as string | undefined;
  const timestamp = req.headers["x-slack-request-timestamp"] as string | undefined;

  if (!verifySlackRequest(signingSecret, signature ?? null, timestamp ?? null, rawBody)) {
    return res.status(401).json({ error: "Invalid request signature" });
  }

  // Parse the slash command payload
  const payload = parseSlashCommandPayload(rawBody);

  // Validate the message
  if (!payload.text || payload.text.trim() === "") {
    return res.status(200).json(
      createErrorResponse("Please provide a message to reword. Usage: `/reword <your message>`")
    );
  }

  const originalMessage = payload.text.trim();

  try {
    // Call Claude via Vercel AI SDK
    const { text: rewordedMessage } = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      system: REWORD_SYSTEM_PROMPT,
      prompt: createRewordUserPrompt(originalMessage),
      maxTokens: 500,
    });

    // Return the reworded message to Slack
    return res.status(200).json(createSlackResponse(originalMessage, rewordedMessage));
  } catch (error) {
    console.error("Error calling Claude:", error);
    return res.status(200).json(
      createErrorResponse("Sorry, I couldn't reword your message. Please try again.")
    );
  }
}

async function getRawBody(req: VercelRequest): Promise<string> {
  // If body is already parsed as a string, return it
  if (typeof req.body === "string") {
    return req.body;
  }

  // If body is a buffer, convert to string
  if (Buffer.isBuffer(req.body)) {
    return req.body.toString("utf8");
  }

  // If body is an object (already parsed), we need the raw body
  // Vercel should provide this, but we may need to reconstruct it
  if (req.body && typeof req.body === "object") {
    // Try to get raw body from Vercel's internal property
    const rawBody = (req as unknown as { rawBody?: string }).rawBody;
    if (rawBody) {
      return rawBody;
    }
    // Reconstruct from parsed body (for URL-encoded form data)
    return new URLSearchParams(req.body as Record<string, string>).toString();
  }

  // Read from stream
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
