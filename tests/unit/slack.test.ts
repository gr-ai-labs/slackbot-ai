import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import {
  parseSlashCommandPayload,
  verifySlackRequest,
  createSlackResponse,
  createErrorResponse,
} from "../../lib/slack.js";

// Helper to generate valid Slack signatures
function generateSlackSignature(
  secret: string,
  timestamp: string,
  body: string
): string {
  const sigBasestring = `v0:${timestamp}:${body}`;
  return "v0=" + createHmac("sha256", secret).update(sigBasestring).digest("hex");
}

describe("parseSlashCommandPayload", () => {
  it("should parse a valid slash command payload", () => {
    const body =
      "token=abc123&team_id=T12345&team_domain=testteam&channel_id=C12345&channel_name=general&user_id=U12345&user_name=testuser&command=%2Freword&text=hello%20world&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2Ftest&trigger_id=123.456.abc";

    const payload = parseSlashCommandPayload(body);

    expect(payload.token).toBe("abc123");
    expect(payload.team_id).toBe("T12345");
    expect(payload.team_domain).toBe("testteam");
    expect(payload.channel_id).toBe("C12345");
    expect(payload.channel_name).toBe("general");
    expect(payload.user_id).toBe("U12345");
    expect(payload.user_name).toBe("testuser");
    expect(payload.command).toBe("/reword");
    expect(payload.text).toBe("hello world");
    expect(payload.response_url).toBe("https://hooks.slack.com/commands/test");
    expect(payload.trigger_id).toBe("123.456.abc");
  });

  it("should handle missing fields with empty strings", () => {
    const body = "token=abc&text=test";

    const payload = parseSlashCommandPayload(body);

    expect(payload.token).toBe("abc");
    expect(payload.text).toBe("test");
    expect(payload.team_id).toBe("");
    expect(payload.user_id).toBe("");
    expect(payload.response_url).toBe("");
  });

  it("should handle empty body", () => {
    const payload = parseSlashCommandPayload("");

    expect(payload.token).toBe("");
    expect(payload.text).toBe("");
    expect(payload.command).toBe("");
  });

  it("should decode URL-encoded special characters", () => {
    const body = "text=Hello%2C%20how%20are%20you%3F&command=%2Freword";

    const payload = parseSlashCommandPayload(body);

    expect(payload.text).toBe("Hello, how are you?");
    expect(payload.command).toBe("/reword");
  });
});

describe("verifySlackRequest", () => {
  const TEST_SECRET = "test-signing-secret-12345";

  it("should accept a valid signature", async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = "text=test&user_id=U123";
    const signature = generateSlackSignature(TEST_SECRET, timestamp, body);

    const result = await verifySlackRequest(TEST_SECRET, signature, timestamp, body);

    expect(result).toBe(true);
  });

  it("should reject an invalid signature", async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = "text=test&user_id=U123";

    const result = await verifySlackRequest(TEST_SECRET, "v0=invalid", timestamp, body);

    expect(result).toBe(false);
  });

  it("should reject when signature is null", async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = "text=test";

    const result = await verifySlackRequest(TEST_SECRET, null, timestamp, body);

    expect(result).toBe(false);
  });

  it("should reject when timestamp is null", async () => {
    const body = "text=test";
    const signature = "v0=somesignature";

    const result = await verifySlackRequest(TEST_SECRET, signature, null, body);

    expect(result).toBe(false);
  });

  it("should reject expired timestamps (older than 5 minutes)", async () => {
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 400).toString(); // 6+ minutes ago
    const body = "text=test&user_id=U123";
    const signature = generateSlackSignature(TEST_SECRET, oldTimestamp, body);

    const result = await verifySlackRequest(TEST_SECRET, signature, oldTimestamp, body);

    expect(result).toBe(false);
  });

  it("should accept timestamps within 5 minute window", async () => {
    const recentTimestamp = (Math.floor(Date.now() / 1000) - 200).toString(); // ~3 minutes ago
    const body = "text=test&user_id=U123";
    const signature = generateSlackSignature(TEST_SECRET, recentTimestamp, body);

    const result = await verifySlackRequest(TEST_SECRET, signature, recentTimestamp, body);

    expect(result).toBe(true);
  });

  it("should reject when body is tampered", async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const originalBody = "text=test&user_id=U123";
    const tamperedBody = "text=hacked&user_id=U123";
    const signature = generateSlackSignature(TEST_SECRET, timestamp, originalBody);

    const result = await verifySlackRequest(TEST_SECRET, signature, timestamp, tamperedBody);

    expect(result).toBe(false);
  });

  it("should reject signatures with wrong version prefix", async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = "text=test";
    const sigBasestring = `v0:${timestamp}:${body}`;
    const hash = createHmac("sha256", TEST_SECRET).update(sigBasestring).digest("hex");
    const wrongVersionSignature = "v1=" + hash; // Wrong version

    const result = await verifySlackRequest(TEST_SECRET, wrongVersionSignature, timestamp, body);

    expect(result).toBe(false);
  });
});

describe("createSlackResponse", () => {
  it("should create a properly formatted response", () => {
    const response = createSlackResponse("original message", "reworded message");

    expect(response.response_type).toBe("ephemeral");
    expect(response.blocks).toBeDefined();
    expect(response.blocks).toHaveLength(4);
  });

  it("should include the reworded message in a section block", () => {
    const response = createSlackResponse("original", "This is the reworded version");

    const rewordedBlock = response.blocks?.find(
      (block) => block.type === "section" && block.text?.text === "This is the reworded version"
    );

    expect(rewordedBlock).toBeDefined();
    expect(rewordedBlock?.text?.type).toBe("mrkdwn");
  });

  it("should include the original message in a context block", () => {
    const response = createSlackResponse("my original message", "reworded");

    const contextBlock = response.blocks?.find(
      (block) => block.type === "context"
    );

    expect(contextBlock).toBeDefined();
    expect(contextBlock?.text?.text).toContain("my original message");
  });

  it("should include a divider block", () => {
    const response = createSlackResponse("original", "reworded");

    const dividerBlock = response.blocks?.find((block) => block.type === "divider");

    expect(dividerBlock).toBeDefined();
  });

  it("should include a header block", () => {
    const response = createSlackResponse("original", "reworded");

    const headerBlock = response.blocks?.find(
      (block) => block.type === "section" && block.text?.text?.includes("reworded message")
    );

    expect(headerBlock).toBeDefined();
  });
});

describe("createErrorResponse", () => {
  it("should create an ephemeral error response", () => {
    const response = createErrorResponse("Something went wrong");

    expect(response.response_type).toBe("ephemeral");
    expect(response.text).toContain("Something went wrong");
  });

  it("should include warning emoji", () => {
    const response = createErrorResponse("Error message");

    expect(response.text).toContain(":warning:");
  });

  it("should handle empty error messages", () => {
    const response = createErrorResponse("");

    expect(response.response_type).toBe("ephemeral");
    expect(response.text).toBeDefined();
  });
});
