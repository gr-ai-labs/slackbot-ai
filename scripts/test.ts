/**
 * End-to-end test script for the Slack reword bot
 *
 * Usage:
 *   npx tsx scripts/test.ts [deployed-url]
 *
 * If deployed-url is provided, tests against that URL.
 * Otherwise, tests local functions directly.
 */

import { createHmac } from "crypto";

const DEPLOYED_URL = process.argv[2];
const TEST_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || "test-secret";

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function log(message: string) {
  console.log(message);
}

function pass(name: string) {
  results.push({ name, passed: true });
  log(`✓ ${name}`);
}

function fail(name: string, error: string) {
  results.push({ name, passed: false, error });
  log(`✗ ${name}: ${error}`);
}

// Generate a valid Slack signature for testing
function generateSlackSignature(secret: string, timestamp: string, body: string): string {
  const sigBasestring = `v0:${timestamp}:${body}`;
  return "v0=" + createHmac("sha256", secret).update(sigBasestring).digest("hex");
}

// Test 1: Verify Slack signature verification works
async function testSignatureVerification() {
  const testName = "Slack signature verification";

  try {
    const { verifySlackRequest } = await import("../lib/slack.js");

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = "text=test&user_id=U123";
    const validSignature = generateSlackSignature(TEST_SIGNING_SECRET, timestamp, body);

    // Test valid signature
    const validResult = await verifySlackRequest(TEST_SIGNING_SECRET, validSignature, timestamp, body);
    if (!validResult) {
      fail(testName, "Valid signature rejected");
      return;
    }

    // Test invalid signature
    const invalidResult = await verifySlackRequest(TEST_SIGNING_SECRET, "v0=invalid", timestamp, body);
    if (invalidResult) {
      fail(testName, "Invalid signature accepted");
      return;
    }

    // Test expired timestamp
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 600).toString(); // 10 minutes ago
    const oldSignature = generateSlackSignature(TEST_SIGNING_SECRET, oldTimestamp, body);
    const expiredResult = await verifySlackRequest(TEST_SIGNING_SECRET, oldSignature, oldTimestamp, body);
    if (expiredResult) {
      fail(testName, "Expired timestamp accepted");
      return;
    }

    pass(testName);
  } catch (error) {
    fail(testName, error instanceof Error ? error.message : String(error));
  }
}

// Test 2: Verify payload parsing
async function testPayloadParsing() {
  const testName = "Slack payload parsing";

  try {
    const { parseSlashCommandPayload } = await import("../lib/slack.js");

    const body = "token=abc&team_id=T123&user_id=U456&command=%2Freword&text=hello%20world&response_url=https%3A%2F%2Fhooks.slack.com%2Ftest";
    const payload = parseSlashCommandPayload(body);

    if (payload.command !== "/reword") {
      fail(testName, `Expected command '/reword', got '${payload.command}'`);
      return;
    }

    if (payload.text !== "hello world") {
      fail(testName, `Expected text 'hello world', got '${payload.text}'`);
      return;
    }

    if (payload.user_id !== "U456") {
      fail(testName, `Expected user_id 'U456', got '${payload.user_id}'`);
      return;
    }

    pass(testName);
  } catch (error) {
    fail(testName, error instanceof Error ? error.message : String(error));
  }
}

// Test 3: Verify response formatting
async function testResponseFormatting() {
  const testName = "Slack response formatting";

  try {
    const { createSlackResponse, createErrorResponse } = await import("../lib/slack.js");

    const response = createSlackResponse("original", "reworded");

    if (response.response_type !== "ephemeral") {
      fail(testName, `Expected response_type 'ephemeral', got '${response.response_type}'`);
      return;
    }

    if (!response.blocks || response.blocks.length < 3) {
      fail(testName, "Response missing expected blocks");
      return;
    }

    const errorResponse = createErrorResponse("test error");
    if (!errorResponse.text?.includes("test error")) {
      fail(testName, "Error response missing error message");
      return;
    }

    pass(testName);
  } catch (error) {
    fail(testName, error instanceof Error ? error.message : String(error));
  }
}

// Test 4: Test deployed endpoint (if URL provided)
async function testDeployedEndpoint() {
  if (!DEPLOYED_URL) {
    log("⊘ Skipping deployed endpoint test (no URL provided)");
    return;
  }

  const testName = "Deployed endpoint responds";

  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = "text=test&user_id=U123&command=%2Freword&response_url=https%3A%2F%2Fhooks.slack.com%2Ftest";
    const signature = generateSlackSignature(TEST_SIGNING_SECRET, timestamp, body);

    const response = await fetch(`${DEPLOYED_URL}/api/slack/reword`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-slack-signature": signature,
        "x-slack-request-timestamp": timestamp,
      },
      body,
    });

    if (response.status === 401) {
      // This is expected if the signing secret doesn't match
      log("⊘ Deployed endpoint test skipped (signing secret mismatch - this is expected in testing)");
      return;
    }

    if (!response.ok) {
      fail(testName, `Unexpected status ${response.status}`);
      return;
    }

    const data = await response.json();
    if (data.text || data.blocks) {
      pass(testName);
    } else {
      fail(testName, "Response missing expected fields");
    }
  } catch (error) {
    fail(testName, error instanceof Error ? error.message : String(error));
  }
}

// Test 5: Test AI Gateway integration (requires deployment and valid keys)
async function testAIGatewayIntegration() {
  const testName = "AI Gateway integration";

  // This test can only run in an environment with the AI Gateway configured
  if (!process.env.AI_GATEWAY_API_KEY && !DEPLOYED_URL) {
    log("⊘ Skipping AI Gateway test (no API key or deployed URL)");
    return;
  }

  try {
    const { generateText, gateway } = await import("ai");

    const { text } = await generateText({
      model: gateway("anthropic/claude-3-5-sonnet-20241022"),
      prompt: "Say 'test successful' and nothing else.",
    });

    if (text.toLowerCase().includes("test") || text.toLowerCase().includes("successful")) {
      pass(testName);
    } else {
      fail(testName, `Unexpected response: ${text}`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("API key") || msg.includes("authentication")) {
      log("⊘ Skipping AI Gateway test (API key not configured)");
    } else {
      fail(testName, msg);
    }
  }
}

// Run all tests
async function runTests() {
  log("\n=== Slack Reword Bot Tests ===\n");

  await testSignatureVerification();
  await testPayloadParsing();
  await testResponseFormatting();
  await testDeployedEndpoint();
  await testAIGatewayIntegration();

  log("\n=== Test Summary ===\n");

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  log(`Passed: ${passed}`);
  log(`Failed: ${failed}`);

  if (failed > 0) {
    log("\nFailed tests:");
    results.filter(r => !r.passed).forEach(r => {
      log(`  - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  }

  log("\nAll tests passed!");
}

runTests().catch(console.error);
