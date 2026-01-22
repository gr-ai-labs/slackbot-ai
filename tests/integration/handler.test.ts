import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

// Mock the ai module
vi.mock("ai", () => ({
  generateText: vi.fn(),
  createGateway: vi.fn(() => (model: string) => ({ modelId: model })),
}));

// Mock fetch for response_url
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { generateText } from "ai";

const TEST_SECRET = "test-signing-secret";

function generateSlackSignature(secret: string, timestamp: string, body: string): string {
  const sigBasestring = `v0:${timestamp}:${body}`;
  return "v0=" + createHmac("sha256", secret).update(sigBasestring).digest("hex");
}

function createMockRequest(method: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://test.vercel.app/api/slack/reword", {
    method,
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
  });
}

describe("API Handler", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    process.env = { ...originalEnv, SLACK_SIGNING_SECRET: TEST_SECRET };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should reject non-POST requests", async () => {
    const handler = (await import("../../api/slack/reword.js")).default;
    const req = new Request("https://test.vercel.app/api/slack/reword", { method: "GET" });
    const response = await handler(req);
    expect(response.status).toBe(405);
  });

  it("should reject requests without SLACK_SIGNING_SECRET configured", async () => {
    delete process.env.SLACK_SIGNING_SECRET;
    vi.resetModules();
    const handler = (await import("../../api/slack/reword.js")).default;
    const req = createMockRequest("POST", "text=test");
    const response = await handler(req);
    expect(response.status).toBe(500);
  });

  it("should reject requests with invalid signature", async () => {
    vi.resetModules();
    const handler = (await import("../../api/slack/reword.js")).default;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const req = createMockRequest("POST", "text=test", {
      "x-slack-signature": "v0=invalid",
      "x-slack-request-timestamp": timestamp,
    });
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

  it("should return acknowledgment and process with waitUntil context", async () => {
    vi.resetModules();
    vi.mocked(generateText).mockResolvedValue({
      text: "Could you please help with this?",
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 10 },
      response: { id: "test", modelId: "test", timestamp: new Date(), headers: {}, messages: [] },
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
    } as never);

    const handler = (await import("../../api/slack/reword.js")).default;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = "text=I%20need%20this%20now&response_url=https://hooks.slack.com/test";
    const signature = generateSlackSignature(TEST_SECRET, timestamp, body);
    const req = createMockRequest("POST", body, {
      "x-slack-signature": signature,
      "x-slack-request-timestamp": timestamp,
    });

    // Create a mock context with waitUntil
    const waitUntilPromises: Promise<unknown>[] = [];
    const context = {
      waitUntil: (p: Promise<unknown>) => { waitUntilPromises.push(p); }
    };

    const response = await handler(req, context);

    // Should return immediate acknowledgment
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.response_type).toBe("ephemeral");
    expect(data.text).toContain("Rewording");

    // Wait for background tasks
    await Promise.all(waitUntilPromises);

    // Should have posted to response_url
    expect(mockFetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/test",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("should reject expired timestamps", async () => {
    vi.resetModules();
    const handler = (await import("../../api/slack/reword.js")).default;
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
});
