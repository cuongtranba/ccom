import { describe, it, expect } from "bun:test";
import { Logger } from "../src/logger";

describe("Logger", () => {
  it("creates a logger with a name", () => {
    const log = new Logger("test");
    expect(log.name).toBe("test");
  });

  it("formats JSON log lines", () => {
    const log = new Logger("ws-client");
    const lines: string[] = [];
    log.setWriter((line) => lines.push(line));

    log.info("connected", { url: "ws://localhost" });
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.level).toBe("info");
    expect(parsed.logger).toBe("ws-client");
    expect(parsed.msg).toBe("connected");
    expect(parsed.url).toBe("ws://localhost");
    expect(parsed.ts).toBeTruthy();
  });

  it("supports warn and error levels", () => {
    const log = new Logger("test");
    const lines: string[] = [];
    log.setWriter((line) => lines.push(line));

    log.warn("caution", { reason: "slow" });
    log.error("failed", { code: "E01" });

    expect(JSON.parse(lines[0]).level).toBe("warn");
    expect(JSON.parse(lines[1]).level).toBe("error");
  });
});
