export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  meta?: Record<string, string>;
}

export class LogBuffer {
  private buffer: LogEntry[] = [];
  private maxSize: number;
  private pushCallback?: (entry: LogEntry) => void;

  constructor(maxSize = 200) {
    this.maxSize = maxSize;
  }

  setOnPush(fn: (entry: LogEntry) => void): void {
    this.pushCallback = fn;
  }

  push(level: LogEntry["level"], message: string, meta?: Record<string, string>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      meta,
    };
    this.buffer.push(entry);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
    this.pushCallback?.(entry);
  }

  info(message: string, meta?: Record<string, string>): void {
    this.push("info", message, meta);
  }

  warn(message: string, meta?: Record<string, string>): void {
    this.push("warn", message, meta);
  }

  error(message: string, meta?: Record<string, string>): void {
    this.push("error", message, meta);
  }

  entries(): LogEntry[] {
    return [...this.buffer];
  }
}
