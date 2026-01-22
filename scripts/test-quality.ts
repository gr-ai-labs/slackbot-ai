import { generateText, createGateway } from "ai";
import { REWORD_SYSTEM_PROMPT, createRewordUserPrompt } from "../lib/prompts.js";

const TEST_MESSAGES = [
  // Short/ambiguous messages
  "need this asap",
  "ok",
  "thanks",
  "fix this",
  "why?",

  // Demanding/urgent
  "I need this done by EOD, no excuses",
  "Drop everything and handle this now",
  "This should have been done yesterday",

  // Complaints/criticism
  "This is wrong, fix it",
  "Why isn't this done yet?",
  "This code is terrible",
  "You keep making the same mistakes",

  // With @mentions
  "@john fix the bug in production",
  "@sarah I need the report NOW",
  "Hey @mike why didn't you finish this?",

  // Already polite (should stay similar)
  "Could you please send me the file?",
  "Thanks for your help with this!",

  // Complex/longer messages
  "The deployment failed again. I told you three times to test before pushing. This is unacceptable.",
  "I don't understand why this is taking so long. We agreed on Friday delivery and it's now Tuesday.",
  "Stop changing things without telling anyone. It breaks everything and wastes everyone's time.",
];

async function runQualityTests() {
  const gateway = createGateway({
    apiKey: process.env.AI_GATEWAY_API_KEY,
  });

  console.log("=".repeat(80));
  console.log("REWORD BOT QUALITY TEST - 20 Example Prompts");
  console.log("Model: Claude Opus 4");
  console.log("=".repeat(80));
  console.log();

  const results: { original: string; reworded: string; time: number }[] = [];

  for (let i = 0; i < TEST_MESSAGES.length; i++) {
    const original = TEST_MESSAGES[i];
    console.log(`[${i + 1}/${TEST_MESSAGES.length}] Testing: "${original.slice(0, 50)}${original.length > 50 ? '...' : ''}"`);

    const startTime = Date.now();
    try {
      const { text: reworded } = await generateText({
        model: gateway("anthropic/claude-opus-4-20250514"),
        system: REWORD_SYSTEM_PROMPT,
        prompt: createRewordUserPrompt(original),
      });
      const time = Date.now() - startTime;

      results.push({ original, reworded, time });
      console.log(`    ✓ Done in ${time}ms`);
    } catch (error) {
      console.log(`    ✗ Error: ${error}`);
      results.push({ original, reworded: `ERROR: ${error}`, time: 0 });
    }
  }

  // Print results
  console.log("\n");
  console.log("=".repeat(80));
  console.log("RESULTS");
  console.log("=".repeat(80));

  for (let i = 0; i < results.length; i++) {
    const { original, reworded, time } = results[i];
    console.log(`\n${i + 1}. ORIGINAL (${time}ms):`);
    console.log(`   "${original}"`);
    console.log(`   REWORDED:`);
    console.log(`   "${reworded}"`);
  }

  // Summary stats
  const times = results.filter(r => r.time > 0).map(r => r.time);
  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);

  console.log("\n");
  console.log("=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));
  console.log(`Total tests: ${TEST_MESSAGES.length}`);
  console.log(`Avg response time: ${avgTime.toFixed(0)}ms`);
  console.log(`Min/Max: ${minTime}ms / ${maxTime}ms`);
  console.log("=".repeat(80));
}

runQualityTests().catch(console.error);
