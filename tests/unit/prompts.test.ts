import { describe, it, expect } from "vitest";
import { REWORD_SYSTEM_PROMPT, createRewordUserPrompt } from "../../lib/prompts.js";

describe("REWORD_SYSTEM_PROMPT", () => {
  it("should be a non-empty string", () => {
    expect(typeof REWORD_SYSTEM_PROMPT).toBe("string");
    expect(REWORD_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("should contain key instructions about preserving core message", () => {
    expect(REWORD_SYSTEM_PROMPT.toLowerCase()).toContain("preserve");
    expect(REWORD_SYSTEM_PROMPT.toLowerCase()).toContain("message");
  });

  it("should mention friendly or diplomatic tone", () => {
    const prompt = REWORD_SYSTEM_PROMPT.toLowerCase();
    expect(prompt).toMatch(/friendly|diplomatic|professional/);
  });

  it("should instruct to output only the reworded message", () => {
    const prompt = REWORD_SYSTEM_PROMPT.toLowerCase();
    expect(prompt).toMatch(/only.*reworded|output.*only/);
  });

  it("should contain transformation examples", () => {
    // Check for example patterns like "→" or transformation examples
    expect(REWORD_SYSTEM_PROMPT).toContain("→");
  });
});

describe("createRewordUserPrompt", () => {
  it("should include the user message", () => {
    const message = "I need this done now";
    const prompt = createRewordUserPrompt(message);

    expect(prompt).toContain(message);
  });

  it("should contain instruction to reword", () => {
    const prompt = createRewordUserPrompt("test message");

    expect(prompt.toLowerCase()).toContain("reword");
  });

  it("should handle empty messages", () => {
    const prompt = createRewordUserPrompt("");

    expect(typeof prompt).toBe("string");
    expect(prompt.toLowerCase()).toContain("reword");
  });

  it("should handle messages with special characters", () => {
    const message = "Why isn't this done?! I said ASAP!!!";
    const prompt = createRewordUserPrompt(message);

    expect(prompt).toContain(message);
  });

  it("should handle multi-line messages", () => {
    const message = "First line\nSecond line\nThird line";
    const prompt = createRewordUserPrompt(message);

    expect(prompt).toContain("First line");
    expect(prompt).toContain("Second line");
    expect(prompt).toContain("Third line");
  });

  it("should mention friendly or diplomatic in the prompt", () => {
    const prompt = createRewordUserPrompt("test");

    expect(prompt.toLowerCase()).toMatch(/friendly|diplomatic/);
  });
});
