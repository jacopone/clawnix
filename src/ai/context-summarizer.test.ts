import { describe, it, expect, afterEach } from "vitest";
import { ConversationManager } from "./context.js";
import { StateStore } from "../core/state.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "/tmp/clawnix-summarizer-test.db";

describe("ConversationManager summarization", () => {
  let state: StateStore;

  afterEach(() => {
    try { state?.close(); } catch {}
    try { unlinkSync(TEST_DB); } catch {}
  });

  it("triggers summarization when message count exceeds threshold", () => {
    state = new StateStore(TEST_DB);
    const cm = new ConversationManager(state, { summarizeThreshold: 5 });

    for (let i = 0; i < 3; i++) {
      cm.addUserMessage("test-conv", `Message ${i}`);
      cm.addAssistantMessage("test-conv", `Reply ${i}`);
    }

    expect(cm.needsSummarization("test-conv")).toBe(true);
  });

  it("does not need summarization below threshold", () => {
    state = new StateStore(TEST_DB);
    const cm = new ConversationManager(state, { summarizeThreshold: 20 });

    cm.addUserMessage("test-conv", "Hello");
    cm.addAssistantMessage("test-conv", "Hi");

    expect(cm.needsSummarization("test-conv")).toBe(false);
  });

  it("stores and retrieves summary", () => {
    state = new StateStore(TEST_DB);
    const cm = new ConversationManager(state);

    cm.setSummary("test-conv", "Previous conversation discussed NixOS bluetooth issues.");

    expect(cm.getSummary("test-conv")).toContain("bluetooth");
  });
});
