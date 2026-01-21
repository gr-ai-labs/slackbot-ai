export interface SlackSlashCommandPayload {
  token: string;
  team_id: string;
  team_domain: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  command: string;
  text: string;
  response_url: string;
  trigger_id: string;
}

export function parseSlashCommandPayload(body: string): SlackSlashCommandPayload {
  const params = new URLSearchParams(body);
  return {
    token: params.get("token") || "",
    team_id: params.get("team_id") || "",
    team_domain: params.get("team_domain") || "",
    channel_id: params.get("channel_id") || "",
    channel_name: params.get("channel_name") || "",
    user_id: params.get("user_id") || "",
    user_name: params.get("user_name") || "",
    command: params.get("command") || "",
    text: params.get("text") || "",
    response_url: params.get("response_url") || "",
    trigger_id: params.get("trigger_id") || "",
  };
}

export async function verifySlackRequest(
  signingSecret: string,
  signature: string | null,
  timestamp: string | null,
  body: string
): Promise<boolean> {
  if (!signature || !timestamp) {
    return false;
  }

  // Check timestamp to prevent replay attacks (allow 5 minute window)
  const currentTime = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(timestamp, 10);
  if (Math.abs(currentTime - requestTime) > 60 * 5) {
    return false;
  }

  // Compute expected signature using Web Crypto API
  const sigBasestring = `v0:${timestamp}:${body}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(sigBasestring)
  );
  const expectedSignature = "v0=" + bufferToHex(signatureBuffer);

  // Use timing-safe comparison
  return timingSafeEqual(signature, expectedSignature);
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export interface SlackResponse {
  response_type?: "in_channel" | "ephemeral";
  text?: string;
  blocks?: SlackBlock[];
}

export interface SlackBlock {
  type: string;
  text?: {
    type: "plain_text" | "mrkdwn";
    text: string;
    emoji?: boolean;
  };
  block_id?: string;
}

export function createSlackResponse(
  originalMessage: string,
  rewordedMessage: string
): SlackResponse {
  return {
    response_type: "ephemeral",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Your reworded message:*",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: rewordedMessage,
        },
      },
      {
        type: "divider",
      },
      {
        type: "context",
        text: {
          type: "mrkdwn",
          text: `_Original: ${originalMessage}_`,
        },
      },
    ],
  };
}

export function createErrorResponse(message: string): SlackResponse {
  return {
    response_type: "ephemeral",
    text: `:warning: ${message}`,
  };
}

export async function postToResponseUrl(
  responseUrl: string,
  response: SlackResponse
): Promise<void> {
  const res = await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(response),
  });
  if (!res.ok) {
    console.error("Failed to post to response_url:", res.status, await res.text());
  }
}
