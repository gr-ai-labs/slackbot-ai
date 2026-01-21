import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "crypto";

/**
 * E2E tests against the deployed Vercel endpoint.
 *
 * These tests require:
 * - DEPLOYED_URL env var set to the Vercel deployment URL
 * - SLACK_SIGNING_SECRET env var set to the actual signing secret
 *
 * Run with: npm run test:e2e
 */

const DEPLOYED_URL = process.env.DEPLOYED_URL;
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

// Helper to generate valid Slack signatures
function generateSlackSignature(
  secret: string,
  timestamp: string,
  body: string
): string {
  const sigBasestring = `v0:${timestamp}:${body}`;
  return "v0=" + createHmac("sha256", secret).update(sigBasestring).digest("hex");
}

// Helper to create form-encoded body
function createFormBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

// Mock response URL server would be needed for full E2E, but we can test the immediate response
describe("E2E: Deployed Endpoint", () => {
  beforeAll(() => {
    if (!DEPLOYED_URL) {
      console.log("Skipping E2E tests: DEPLOYED_URL not set");
    }
  });

  describe("Endpoint availability", () => {
    it("should be reachable", async () => {
      if (!DEPLOYED_URL) return;

      const response = await fetch(`${DEPLOYED_URL}/api/slack/reword`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "text=test",
      });

      // Should respond (even with 401 for invalid signature)
      expect(response.status).toBeLessThan(500);
    });

    it("should reject GET requests", async () => {
      if (!DEPLOYED_URL) return;

      const response = await fetch(`${DEPLOYED_URL}/api/slack/reword`, {
        method: "GET",
      });

      expect(response.status).toBe(405);
    });

    it("should reject requests without signature", async () => {
      if (!DEPLOYED_URL) return;

      const response = await fetch(`${DEPLOYED_URL}/api/slack/reword`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "text=test",
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Invalid request signature");
    });

    it("should reject requests with invalid signature", async () => {
      if (!DEPLOYED_URL) return;

      const timestamp = Math.floor(Date.now() / 1000).toString();

      const response = await fetch(`${DEPLOYED_URL}/api/slack/reword`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "x-slack-signature": "v0=invalid",
          "x-slack-request-timestamp": timestamp,
        },
        body: "text=test",
      });

      expect(response.status).toBe(401);
    });
  });

  describe("Authenticated requests", () => {
    it("should return error for empty message with valid signature", async () => {
      if (!DEPLOYED_URL || !SIGNING_SECRET) {
        console.log("Skipping: DEPLOYED_URL or SLACK_SIGNING_SECRET not set");
        return;
      }

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const body = createFormBody({
        text: "",
        response_url: "https://hooks.slack.com/test",
      });
      const signature = generateSlackSignature(SIGNING_SECRET, timestamp, body);

      const response = await fetch(`${DEPLOYED_URL}/api/slack/reword`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "x-slack-signature": signature,
          "x-slack-request-timestamp": timestamp,
        },
        body,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.text).toContain("Please provide a message");
    });

    it("should return acknowledgment for valid message", async () => {
      if (!DEPLOYED_URL || !SIGNING_SECRET) {
        console.log("Skipping: DEPLOYED_URL or SLACK_SIGNING_SECRET not set");
        return;
      }

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const body = createFormBody({
        text: "I need this done now",
        response_url: "https://hooks.slack.com/test",
        user_id: "U12345",
        command: "/reword",
      });
      const signature = generateSlackSignature(SIGNING_SECRET, timestamp, body);

      const response = await fetch(`${DEPLOYED_URL}/api/slack/reword`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "x-slack-signature": signature,
          "x-slack-request-timestamp": timestamp,
        },
        body,
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.text).toBe("Rewording your message...");
      expect(data.response_type).toBe("ephemeral");
    });

    it("should reject expired timestamps", async () => {
      if (!DEPLOYED_URL || !SIGNING_SECRET) {
        console.log("Skipping: DEPLOYED_URL or SLACK_SIGNING_SECRET not set");
        return;
      }

      // Timestamp from 10 minutes ago
      const oldTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();
      const body = createFormBody({
        text: "test message",
        response_url: "https://hooks.slack.com/test",
      });
      const signature = generateSlackSignature(SIGNING_SECRET, oldTimestamp, body);

      const response = await fetch(`${DEPLOYED_URL}/api/slack/reword`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "x-slack-signature": signature,
          "x-slack-request-timestamp": oldTimestamp,
        },
        body,
      });

      expect(response.status).toBe(401);
    });
  });
});

describe("E2E: AI Gateway Integration", () => {
  it("should successfully call AI Gateway with valid credentials", async () => {
    if (!process.env.AI_GATEWAY_API_KEY) {
      console.log("Skipping: AI_GATEWAY_API_KEY not set");
      return;
    }

    // Test direct AI Gateway call
    const { generateText, gateway } = await import("ai");

    const result = await generateText({
      model: gateway("anthropic/claude-3-5-sonnet-20241022"),
      prompt: "Reply with exactly: TEST_SUCCESS",
    });

    expect(result.text).toContain("TEST_SUCCESS");
  });

  it("should reword a message through AI Gateway", async () => {
    if (!process.env.AI_GATEWAY_API_KEY) {
      console.log("Skipping: AI_GATEWAY_API_KEY not set");
      return;
    }

    const { generateText, gateway } = await import("ai");
    const { REWORD_SYSTEM_PROMPT, createRewordUserPrompt } = await import(
      "../../lib/prompts.js"
    );

    const originalMessage = "I need this done ASAP, this is blocking me!";

    const result = await generateText({
      model: gateway("anthropic/claude-3-5-sonnet-20241022"),
      system: REWORD_SYSTEM_PROMPT,
      prompt: createRewordUserPrompt(originalMessage),
    });

    // The reworded message should exist and be different from the original
    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(0);
    // Should be more polite (not contain aggressive language)
    expect(result.text.toLowerCase()).not.toContain("asap");
  });
});

describe("E2E: Full Slack Flow Simulation", () => {
  it("should handle a complete slash command flow", async () => {
    if (!DEPLOYED_URL || !SIGNING_SECRET) {
      console.log("Skipping: DEPLOYED_URL or SLACK_SIGNING_SECRET not set");
      return;
    }

    // Simulate what Slack sends when user types: /reword Fix this bug immediately!
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = createFormBody({
      token: "test-token",
      team_id: "T12345",
      team_domain: "testworkspace",
      channel_id: "C12345",
      channel_name: "general",
      user_id: "U12345",
      user_name: "testuser",
      command: "/reword",
      text: "Fix this bug immediately!",
      response_url: "https://hooks.slack.com/commands/T12345/test",
      trigger_id: "123.456.test",
    });
    const signature = generateSlackSignature(SIGNING_SECRET, timestamp, body);

    const response = await fetch(`${DEPLOYED_URL}/api/slack/reword`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-slack-signature": signature,
        "x-slack-request-timestamp": timestamp,
      },
      body,
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    // Should return immediate acknowledgment
    expect(data.response_type).toBe("ephemeral");
    expect(data.text).toBe("Rewording your message...");

    // Note: The actual reworded message is sent asynchronously to response_url
    // which we can't verify without setting up a mock server
  });

  it("should handle special characters in messages", async () => {
    if (!DEPLOYED_URL || !SIGNING_SECRET) {
      console.log("Skipping: DEPLOYED_URL or SLACK_SIGNING_SECRET not set");
      return;
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = createFormBody({
      text: "Why isn't this done?! I asked 3 times already!!!",
      response_url: "https://hooks.slack.com/test",
      command: "/reword",
    });
    const signature = generateSlackSignature(SIGNING_SECRET, timestamp, body);

    const response = await fetch(`${DEPLOYED_URL}/api/slack/reword`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-slack-signature": signature,
        "x-slack-request-timestamp": timestamp,
      },
      body,
    });

    expect(response.status).toBe(200);
  });

  it("should handle unicode/emoji in messages", async () => {
    if (!DEPLOYED_URL || !SIGNING_SECRET) {
      console.log("Skipping: DEPLOYED_URL or SLACK_SIGNING_SECRET not set");
      return;
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = createFormBody({
      text: "This is terrible 😡 fix it now!",
      response_url: "https://hooks.slack.com/test",
      command: "/reword",
    });
    const signature = generateSlackSignature(SIGNING_SECRET, timestamp, body);

    const response = await fetch(`${DEPLOYED_URL}/api/slack/reword`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-slack-signature": signature,
        "x-slack-request-timestamp": timestamp,
      },
      body,
    });

    expect(response.status).toBe(200);
  });
});
