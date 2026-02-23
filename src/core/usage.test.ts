import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { UsageTracker } from "./usage.js";
import Database from "better-sqlite3";
import { unlinkSync } from "node:fs";

const TEST_DB = "/tmp/clawnix-usage-test.db";

describe("UsageTracker", () => {
  let db: Database.Database;
  let tracker: UsageTracker;

  beforeEach(() => {
    try { unlinkSync(TEST_DB); } catch {}
    db = new Database(TEST_DB);
    tracker = new UsageTracker(db);
  });

  afterEach(() => {
    db.close();
    try { unlinkSync(TEST_DB); } catch {}
  });

  it("records and retrieves usage", () => {
    tracker.record("personal", "claude-sonnet-4-6", 1000, 500);
    tracker.record("personal", "claude-sonnet-4-6", 2000, 800);

    const recent = tracker.recent();
    expect(recent).toHaveLength(2);
    expect(recent[0].inputTokens).toBe(2000); // most recent first
    expect(recent[0].agent).toBe("personal");
  });

  it("summarizes usage by agent", () => {
    tracker.record("personal", "claude-sonnet-4-6", 1000, 500);
    tracker.record("devops", "claude-sonnet-4-6", 3000, 1000);
    tracker.record("personal", "claude-sonnet-4-6", 2000, 800);

    const summary = tracker.summary();
    expect(summary.totalInputTokens).toBe(6000);
    expect(summary.totalOutputTokens).toBe(2300);
    expect(summary.totalCalls).toBe(3);
    expect(summary.byAgent.personal.inputTokens).toBe(3000);
    expect(summary.byAgent.personal.calls).toBe(2);
    expect(summary.byAgent.devops.inputTokens).toBe(3000);
    expect(summary.byAgent.devops.calls).toBe(1);
  });

  it("respects the limit parameter for recent()", () => {
    for (let i = 0; i < 10; i++) {
      tracker.record("agent", "model", i * 100, i * 50);
    }
    const recent = tracker.recent(3);
    expect(recent).toHaveLength(3);
  });

  it("returns empty summary when no records exist", () => {
    const summary = tracker.summary();
    expect(summary.totalInputTokens).toBe(0);
    expect(summary.totalCalls).toBe(0);
    expect(Object.keys(summary.byAgent)).toHaveLength(0);
  });
});
