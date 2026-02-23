import { describe, it, expect } from "vitest";
import { parseApprovalCommand, parseCallbackData } from "./approval.js";

describe("parseApprovalCommand", () => {
  it("parses /allow <id>", () => {
    const result = parseApprovalCommand("/allow abc123");
    expect(result).toEqual({ decision: "allow", id: "abc123" });
  });

  it("parses /deny <id>", () => {
    const result = parseApprovalCommand("/deny abc123");
    expect(result).toEqual({ decision: "deny", id: "abc123" });
  });

  it("returns null for non-approval messages", () => {
    expect(parseApprovalCommand("hello")).toBeNull();
    expect(parseApprovalCommand("/start")).toBeNull();
  });

  it("returns null when id is missing", () => {
    expect(parseApprovalCommand("/allow")).toBeNull();
    expect(parseApprovalCommand("/deny ")).toBeNull();
  });
});

describe("parseCallbackData", () => {
  it("parses approve callback", () => {
    expect(parseCallbackData("approve:abc123")).toEqual({ decision: "allow", id: "abc123" });
  });
  it("parses deny callback", () => {
    expect(parseCallbackData("deny:abc123")).toEqual({ decision: "deny", id: "abc123" });
  });
  it("returns null for unknown format", () => {
    expect(parseCallbackData("something:else")).toBeNull();
  });
});
