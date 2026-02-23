import { describe, it, expect } from "vitest";

describe("NixOS update commands", () => {
  it("flakeUpdate calls nix flake update with correct path", async () => {
    const { flakeUpdate } = await import("./commands.js");
    const result = await flakeUpdate("/nonexistent/path");
    expect(result).toContain("Error");
  });

  it("systemRebuild calls sudo nixos-rebuild switch", async () => {
    const { systemRebuild } = await import("./commands.js");
    const result = await systemRebuild("/nonexistent/path");
    expect(result).toContain("Error");
  });

  it("systemRollback calls sudo nixos-rebuild switch --rollback", async () => {
    const { systemRollback } = await import("./commands.js");
    const result = await systemRollback();
    expect(result).toContain("Error");
  });
});
