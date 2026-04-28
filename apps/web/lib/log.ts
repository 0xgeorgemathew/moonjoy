type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const originals = {
  log: console.log,
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

let currentLevel: LogLevel = "info";

function readEnvLevel(): LogLevel {
  if (typeof window !== "undefined") {
    const val = process.env.NEXT_PUBLIC_LOG_LEVEL;
    if (val && val in LEVELS) return val as LogLevel;
  } else {
    const val = process.env.LOG_LEVEL;
    if (val && val in LEVELS) return val as LogLevel;
  }
  return "info";
}

function noop() {}

function makeGate(level: LogLevel, original: (...args: unknown[]) => void) {
  const threshold = LEVELS[level];
  return (...args: unknown[]) => {
    if (LEVELS[currentLevel] <= threshold) {
      original(...args);
    }
  };
}

export function setLogLevel(level: LogLevel) {
  if (!(level in LEVELS)) return;
  currentLevel = level;
  console.log = makeGate("info", originals.log);
  console.debug = makeGate("debug", originals.debug);
  console.info = makeGate("info", originals.info);
  console.warn = makeGate("warn", originals.warn);
  console.error = makeGate("error", originals.error);
}

export function initLogging() {
  currentLevel = readEnvLevel();
  setLogLevel(currentLevel);

  if (typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>).__setLogLevel__ = setLogLevel;
  }
}
