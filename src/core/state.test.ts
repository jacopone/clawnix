import { describe, it, expect, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { StateStore } from "./state.js";

const DB_PATH = "/tmp/clawnix-test.db";

function cleanup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = DB_PATH + suffix;
    if (existsSync(file)) unlinkSync(file);
  }
}

describe("StateStore", () => {
  afterEach(() => {
    cleanup();
  });

  it("stores and retrieves a value", () => {
    const store = new StateStore(DB_PATH);
    store.set("ns", "key1", "value1");
    expect(store.get("ns", "key1")).toBe("value1");
    store.close();
  });

  it("returns undefined for missing keys", () => {
    const store = new StateStore(DB_PATH);
    expect(store.get("ns", "nonexistent")).toBeUndefined();
    store.close();
  });

  it("overwrites existing values", () => {
    const store = new StateStore(DB_PATH);
    store.set("ns", "key1", "first");
    store.set("ns", "key1", "second");
    expect(store.get("ns", "key1")).toBe("second");
    store.close();
  });

  it("isolates namespaces", () => {
    const store = new StateStore(DB_PATH);
    store.set("ns1", "key", "value-a");
    store.set("ns2", "key", "value-b");
    expect(store.get("ns1", "key")).toBe("value-a");
    expect(store.get("ns2", "key")).toBe("value-b");
    store.close();
  });

  it("deletes a key", () => {
    const store = new StateStore(DB_PATH);
    store.set("ns", "key1", "value1");
    store.delete("ns", "key1");
    expect(store.get("ns", "key1")).toBeUndefined();
    store.close();
  });

  it("stores and retrieves JSON", () => {
    const store = new StateStore(DB_PATH);
    const data = { count: 42, tags: ["a", "b"] };
    store.setJSON("ns", "obj", data);
    expect(store.getJSON("ns", "obj")).toEqual(data);
    store.close();
  });
});
