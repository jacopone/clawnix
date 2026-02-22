import { describe, it, expect, vi } from "vitest";
import { HaikuClassifier } from "./classifier.js";

describe("HaikuClassifier", () => {
  it("calls Anthropic API with haiku model and returns classification", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "devops" }],
    });

    const classifier = new HaikuClassifier("test-key");
    (classifier as any).client = { messages: { create: mockCreate } };

    const result = await classifier.classify(
      "Route to correct agent:\n- personal: calendar\n- devops: servers",
      "check nginx health",
    );

    expect(result).toBe("devops");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 50,
      }),
    );
  });

  it("trims whitespace from classification result", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "  personal  \n" }],
    });

    const classifier = new HaikuClassifier("test-key");
    (classifier as any).client = { messages: { create: mockCreate } };

    const result = await classifier.classify("prompt", "message");
    expect(result).toBe("personal");
  });
});
