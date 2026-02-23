import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadPersonality } from "./personality.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const TEST_DIR = "/tmp/clawnix-personality-test";

describe("loadPersonality", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("loads IDENTITY.md into prompt", () => {
    writeFileSync(`${TEST_DIR}/IDENTITY.md`, "You are TestClaw, a testing assistant.");
    const prompt = loadPersonality(TEST_DIR);
    expect(prompt).toContain("TestClaw");
  });

  it("loads SOUL.md and USER.md if present", () => {
    writeFileSync(`${TEST_DIR}/IDENTITY.md`, "Identity here.");
    writeFileSync(`${TEST_DIR}/SOUL.md`, "Be kind and helpful.");
    writeFileSync(`${TEST_DIR}/USER.md`, "User prefers concise answers.");
    const prompt = loadPersonality(TEST_DIR);
    expect(prompt).toContain("Be kind");
    expect(prompt).toContain("concise answers");
  });

  it("returns default prompt when no files exist", () => {
    const prompt = loadPersonality(TEST_DIR);
    expect(prompt).toContain("ClawNix");
    expect(prompt.length).toBeGreaterThan(50);
  });

  it("loads MEMORY.md as persistent knowledge", () => {
    writeFileSync(`${TEST_DIR}/IDENTITY.md`, "Identity.");
    mkdirSync(`${TEST_DIR}/memory`, { recursive: true });
    writeFileSync(`${TEST_DIR}/memory/MEMORY.md`, "User's bluetooth broke on gen 487.");
    const prompt = loadPersonality(TEST_DIR);
    expect(prompt).toContain("gen 487");
  });

  it("loads GLOBAL.md from globalDir when provided", () => {
    const globalDir = `${TEST_DIR}/global`;
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(`${TEST_DIR}/IDENTITY.md`, "Identity.");
    writeFileSync(`${globalDir}/GLOBAL.md`, "The NixOS hostname is archon.");
    const prompt = loadPersonality(TEST_DIR, globalDir);
    expect(prompt).toContain("archon");
    expect(prompt).toContain("Global Knowledge");
  });

  it("skips GLOBAL.md when globalDir is not provided", () => {
    writeFileSync(`${TEST_DIR}/IDENTITY.md`, "Identity.");
    const prompt = loadPersonality(TEST_DIR);
    expect(prompt).not.toContain("Global Knowledge");
  });

  it("skips GLOBAL.md when file does not exist in globalDir", () => {
    const globalDir = `${TEST_DIR}/global-empty`;
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(`${TEST_DIR}/IDENTITY.md`, "Identity.");
    const prompt = loadPersonality(TEST_DIR, globalDir);
    expect(prompt).not.toContain("Global Knowledge");
  });
});
