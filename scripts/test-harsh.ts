import { generateText, createGateway } from "ai";
import { REWORD_SYSTEM_PROMPT, createRewordUserPrompt } from "../lib/prompts.js";

const HARSH_MESSAGES = [
  // Performance criticism
  "I've reviewed your work and honestly it's nowhere near the quality we expect. You need to step up or we'll have to reconsider your position on this project.",
  "This is the third time this month you've missed a deadline. I'm starting to question whether you're capable of handling this workload.",
  "Your presentation to the client was embarrassing. You clearly didn't prepare and it made the whole team look incompetent.",

  // Code/technical criticism
  "Who wrote this garbage? This code is unmaintainable spaghetti and whoever approved this PR should be ashamed. Rewrite the entire thing.",
  "I can't believe you pushed this to production without testing. Now we have angry customers and it's entirely your fault. Fix it immediately.",
  "Your architecture decisions are fundamentally flawed. Did you even think about scalability? This will never handle our load and we'll have to rebuild everything.",

  // Process/communication failures
  "Why am I always the last to know about these changes? You went ahead and made decisions without consulting anyone and now we're all scrambling to clean up your mess.",
  "I explicitly told you NOT to do this. You completely ignored my instructions and now we have a major problem. What part of 'don't deploy on Friday' didn't you understand?",
  "Your documentation is useless. I've spent hours trying to figure out how this works because you couldn't be bothered to write proper docs. This is basic professionalism.",

  // Deadline/delivery issues
  "The client is furious because you promised something you couldn't deliver. This damages our reputation and I'm the one who has to apologize for YOUR mistakes.",
  "We've been waiting three weeks for this feature. Every day you have a new excuse. I don't want excuses, I want results. Get it done or tell me now if you can't.",
  "You assured me this would be ready for the demo. Now I'm standing in front of executives with nothing to show. Do you have any idea how bad this looks?",

  // Team/collaboration issues
  "Stop undermining your teammates in meetings. Your constant criticism isn't constructive, it's toxic, and it's destroying team morale.",
  "I've had multiple complaints about your attitude. You're dismissive, condescending, and difficult to work with. This needs to change immediately.",
  "Your refusal to help others is unacceptable. We're a team, not a collection of individuals. Either start collaborating or find somewhere else to work.",

  // Quality/attention to detail
  "Did you even proofread this before sending it to the client? There are typos everywhere and the numbers don't add up. This is embarrassing and unprofessional.",
  "I'm tired of finding bugs in your code that basic testing would have caught. Your carelessness is costing us time and money. Start taking quality seriously.",
  "The design you submitted looks like it was done in five minutes. Our clients pay premium prices and expect premium work, not this amateur hour nonsense.",

  // Accountability issues
  "Stop blaming everyone else for your failures. The database issue was caused by YOUR code, not the infrastructure team. Own your mistakes for once.",
  "I don't care whose fault it is, I care about fixing it. But since you asked, yes, this is absolutely your responsibility and you need to make it right.",
];

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runHarshTests() {
  const gateway = createGateway({
    apiKey: process.env.AI_GATEWAY_API_KEY,
  });

  console.log("=".repeat(80));
  console.log("HARSH MESSAGE QUALITY TEST - 20 Critical/Harsh Sentences");
  console.log("Model: Claude Opus 4");
  console.log("=".repeat(80));
  console.log();

  const results: { original: string; reworded: string; time: number }[] = [];

  for (let i = 0; i < HARSH_MESSAGES.length; i++) {
    const original = HARSH_MESSAGES[i];
    console.log(`[${i + 1}/${HARSH_MESSAGES.length}] Testing...`);

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
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`    ✗ Error: ${errorMsg.slice(0, 80)}`);
      results.push({ original, reworded: `ERROR: ${errorMsg}`, time: 0 });

      // If rate limited, wait longer
      if (errorMsg.includes('RateLimit')) {
        console.log(`    Waiting 10s before retry...`);
        await sleep(10000);
      }
    }

    // Add delay between requests to avoid rate limiting
    await sleep(2000);
  }

  // Print results
  console.log("\n");
  console.log("=".repeat(80));
  console.log("RESULTS - HARSH MESSAGES");
  console.log("=".repeat(80));

  for (let i = 0; i < results.length; i++) {
    const { original, reworded, time } = results[i];
    console.log(`\n${"─".repeat(80)}`);
    console.log(`${i + 1}. ORIGINAL:`);
    console.log(`   "${original}"`);
    console.log(`\n   REWORDED (${time}ms):`);
    console.log(`   "${reworded}"`);
  }

  // Summary stats
  const successResults = results.filter(r => r.time > 0);
  if (successResults.length > 0) {
    const times = successResults.map(r => r.time);
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;

    console.log("\n");
    console.log("=".repeat(80));
    console.log("SUMMARY");
    console.log("=".repeat(80));
    console.log(`Successful: ${successResults.length}/${HARSH_MESSAGES.length}`);
    console.log(`Avg response time: ${avgTime.toFixed(0)}ms`);
  }
}

runHarshTests().catch(console.error);
