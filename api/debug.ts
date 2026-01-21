import { generateText, createGateway } from "ai";
import { REWORD_SYSTEM_PROMPT, createRewordUserPrompt } from "../lib/prompts.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 30,
};

export default async function handler(req: Request) {
  const logs: string[] = [];
  const log = (msg: string) => {
    const entry = `${new Date().toISOString()} - ${msg}`;
    logs.push(entry);
    console.log(entry);
  };

  try {
    log("Debug endpoint called");

    // Check environment
    const hasGatewayKey = !!process.env.AI_GATEWAY_API_KEY;
    const gatewayKeyPrefix = process.env.AI_GATEWAY_API_KEY?.slice(0, 10) || "NOT_SET";
    log(`AI_GATEWAY_API_KEY present: ${hasGatewayKey}, prefix: ${gatewayKeyPrefix}...`);

    if (!hasGatewayKey) {
      return new Response(JSON.stringify({
        error: "AI_GATEWAY_API_KEY not configured",
        logs
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    log("Creating gateway...");
    const gateway = createGateway({
      apiKey: process.env.AI_GATEWAY_API_KEY,
    });
    log("Gateway created");

    log("Calling AI with test message...");
    const startTime = Date.now();

    const { text: rewordedMessage } = await generateText({
      model: gateway("anthropic/claude-3-haiku-20240307"),
      system: REWORD_SYSTEM_PROMPT,
      prompt: createRewordUserPrompt("I need this done NOW"),
    });

    const duration = Date.now() - startTime;
    log(`AI responded in ${duration}ms`);
    log(`Response: ${rewordedMessage.slice(0, 100)}...`);

    return new Response(JSON.stringify({
      success: true,
      duration,
      rewordedMessage,
      logs,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    log(`ERROR: ${errorMessage}`);
    log(`Stack: ${errorStack}`);

    return new Response(JSON.stringify({
      error: errorMessage,
      stack: errorStack,
      logs,
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
