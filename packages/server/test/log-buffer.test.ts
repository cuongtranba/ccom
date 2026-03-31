import { describe, test, expect } from "bun:test";
import { LogBuffer } from "../src/log-buffer";
import type { LogEntry } from "../src/log-buffer";

describe("LogBuffer", () => {
  test("setOnPush callback fires on every push", () => {
    const buf = new LogBuffer(10);
    const captured: LogEntry[] = [];
    buf.setOnPush((entry) => captured.push(entry));

    buf.info("hello", { key: "val" });
    buf.warn("caution");
    buf.error("boom");

    expect(captured).toHaveLength(3);
    expect(captured[0].level).toBe("info");
    expect(captured[0].message).toBe("hello");
    expect(captured[0].meta).toEqual({ key: "val" });
    expect(captured[1].level).toBe("warn");
    expect(captured[2].level).toBe("error");
  });

  test("setOnPush not called when not set", () => {
    const buf = new LogBuffer(10);
    buf.info("no callback");
    expect(buf.entries()).toHaveLength(1);
  });

  test("setOnPush can be replaced", () => {
    const buf = new LogBuffer(10);
    const calls: string[] = [];
    buf.setOnPush((e) => calls.push("first:" + e.message));
    buf.info("one");
    buf.setOnPush((e) => calls.push("second:" + e.message));
    buf.info("two");
    expect(calls).toEqual(["first:one", "second:two"]);
  });
});
