import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

// Mock the ai module before importing the handler
vi.mock("ai", () => ({
  generateText: vi.fn(),
  createGateway: vi.fn(() => (model: string) => ({ modelId: model })),
}));

import { generateText } from "ai";

// Helper to generate valid Slack signatures
function generateSlackSignature(
  secret: string,
  timestamp: string,
  body: string
): string {
  const sigBasestring = `v0:${timestamp}:${body}`;
  return "v0=" + createHmac("sha256", secret).update(sigBasestring).digest("hex");
}

// Helper to create a mock Request object
function createMockRequest(
  method: string,
  body: string,
  headers: Record<string, string> = {}
): Request {
  return new Request("https://test.vercel.app/api/slack/reword", {
    method,
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
  });
}

describe("API Handler", () => {
  const TEST_SECRET = "test-signing-secret";
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv, SLACK_SIGNING_SECRET: TEST_SECRET };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should reject non-POST requests", async () => {
    const handler = (await import("../../api/slack/reword.js")).default;

    const req = new Request("https://test.vercel.app/api/slack/reword", {
      method: "GET",
    });

    const response = await handler(req);

    expect(response.status).toBe(405);
    const data = await response.json();
    expect(data.error).toBe("Method not allowed");
  });

  it("should reject requests without SLACK_SIGNING_SECRET configured", async () => {
    delete process.env.SLACK_SIGNING_SECRET;

    // Need to re-import to pick up env change
    vi.resetModules();
    const handler = (await import("../../api/slack/reword.js")).default;

    const req = createMockRequest("POST", "text=test");

    const response = await handler(req);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Server configuration error");
  });

  it("should reject requests with invalid signature", async () => {
    vi.resetModules();
    const handler = (await import("../../api/slack/reword.js")).default;

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = "text=test&response_url=https://hooks.slack.com/test";

    const req = createMockRequest("POST", body, {
      "x-slack-signature": "v0=invalid",
      "x-slack-request-timestamp": timestamp,
    });

    const response = await handler(req);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Invalid request signature");
  });

  it("should reject requests with missing signature", async () => {
    vi.resetModules();
    const handler = (await import("../../api/slack/reword.js")).default;

    const req = createMockRequest("POST", "text=test");

    const response = await handler(req);

    expect(response.status).toBe(401);
  });

  it("should return error for empty message", async () => {
    vi.resetModules();
    const handler = (await import("../../api/slack/reword.js")).default;

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = "text=&response_url=https://hooks.slack.com/test";
    const signature = generateSlackSignature(TEST_SECRET, timestamp, body);

    const req = createMockRequest("POST", body, {
      "x-slack-signature": signature,
      "x-slack-request-timestamp": timestamp,
    });

    const response = await handler(req);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.text).toContain("Please provide a message");
  });

  it("should return acknowledgment for valid request", async () => {
    vi.resetModules();

    // Mock generateText to return a reworded message
    vi.mocked(generateText).mockResolvedValue({
      text: "Could you please help with this?",
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      response: {
        id: "test",
        modelId: "test",
        timestamp: new Date(),
        headers: {},
        body: undefined,
      },
      reasoning: undefined,
      reasoningDetails: [],
      sources: [],
      files: [],
      toolCalls: [],
      toolResults: [],
      steps: [],
      warnings: [],
      rawResponse: undefined,
      providerMetadata: undefined,
      request: { body: "" },
      experimental_providerMetadata: undefined,
      toJsonResponse: () => new Response(),
    });

    // Mock fetch for response_url
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const handler = (await import("../../api/slack/reword.js")).default;

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = "text=I%20need%20this%20now&response_url=https://hooks.slack.com/test";
    const signature = generateSlackSignature(TEST_SECRET, timestamp, body);

    const req = createMockRequest("POST", body, {
      "x-slack-signature": signature,
      "x-slack-request-timestamp": timestamp,
    });

    const response = await handler(req);

    expect(response.status).toBe(200);
    const data = await response.json();
    // Should return the reworded message directly
    expect(data.blocks).toBeDefined();
    expect(data.response_type).toBe("ephemeral");

    fetchSpy.mockRestore();
  });

  it("should handle whitespace-only messages as empty", async () => {
    vi.resetModules();
    const handler = (await import("../../api/slack/reword.js")).default;

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = "text=%20%20%20&response_url=https://hooks.slack.com/test";
    const signature = generateSlackSignature(TEST_SECRET, timestamp, body);

    const req = createMockRequest("POST", body, {
      "x-slack-signature": signature,
      "x-slack-request-timestamp": timestamp,
    });

    const response = await handler(req);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.text).toContain("Please provide a message");
  });
});

describe("Request signature edge cases", () => {
  const TEST_SECRET = "test-signing-secret";

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.SLACK_SIGNING_SECRET = TEST_SECRET;
  });

  it("should reject expired timestamps", async () => {
    vi.resetModules();
    const handler = (await import("../../api/slack/reword.js")).default;

    // Timestamp from 10 minutes ago
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();
    const body = "text=test&response_url=https://hooks.slack.com/test";
    const signature = generateSlackSignature(TEST_SECRET, oldTimestamp, body);

    const req = createMockRequest("POST", body, {
      "x-slack-signature": signature,
      "x-slack-request-timestamp": oldTimestamp,
    });

    const response = await handler(req);

    expect(response.status).toBe(401);
  });

  it("should accept recent timestamps within window", async () => {
    vi.resetModules();

    vi.mocked(generateText).mockResolvedValue({
      text: "Reworded message",
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      response: {
        id: "test",
        modelId: "test",
        timestamp: new Date(),
        headers: {},
        body: undefined,
      },
      reasoning: undefined,
      reasoningDetails: [],
      sources: [],
      files: [],
      toolCalls: [],
      toolResults: [],
      steps: [],
      warnings: [],
      rawResponse: undefined,
      providerMetadata: undefined,
      request: { body: "" },
      experimental_providerMetadata: undefined,
      toJsonResponse: () => new Response(),
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const handler = (await import("../../api/slack/reword.js")).default;

    // Timestamp from 2 minutes ago (within 5 minute window)
    const recentTimestamp = (Math.floor(Date.now() / 1000) - 120).toString();
    const body = "text=test&response_url=https://hooks.slack.com/test";
    const signature = generateSlackSignature(TEST_SECRET, recentTimestamp, body);

    const req = createMockRequest("POST", body, {
      "x-slack-signature": signature,
      "x-slack-request-timestamp": recentTimestamp,
    });

    const response = await handler(req);

    expect(response.status).toBe(200);
  });
});
