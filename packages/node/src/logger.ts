type LogLevel = "info" | "warn" | "error";
type WriteFn = (line: string) => void;

export class Logger {
  readonly name: string;
  private writer: WriteFn = (line) => process.stderr.write(line + "\n");

  constructor(name: string) {
    this.name = name;
  }

  setWriter(fn: WriteFn): void {
    this.writer = fn;
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this.log("info", msg, data);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this.log("warn", msg, data);
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.log("error", msg, data);
  }

  private log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    const entry = {
      ts: new Date().toISOString(),
      level,
      logger: this.name,
      msg,
      ...data,
    };
    this.writer(JSON.stringify(entry));
  }
}
