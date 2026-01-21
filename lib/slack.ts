import { createHmac, timingSafeEqual } from "crypto";

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

export function verifySlackRequest(
  signingSecret: string,
  signature: string | null,
  timestamp: string | null,
  body: string
): boolean {
  if (!signature || !timestamp) {
    return false;
  }

  // Check timestamp to prevent replay attacks (allow 5 minute window)
  const currentTime = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(timestamp, 10);
  if (Math.abs(currentTime - requestTime) > 60 * 5) {
    return false;
  }

  // Compute expected signature
  const sigBasestring = `v0:${timestamp}:${body}`;
  const expectedSignature =
    "v0=" + createHmac("sha256", signingSecret).update(sigBasestring).digest("hex");

  // Use timing-safe comparison
  try {
    return timingSafeEqual(
      Buffer.from(signature, "utf8"),
      Buffer.from(expectedSignature, "utf8")
    );
  } catch {
    return false;
  }
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
