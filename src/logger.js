"use strict";

// References:
// - Node.js fs promises API for simple append-only local debug logs:
//   https://nodejs.org/api/fs.html#promises-api

const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_LOG_FILE = "data/llm-model-forward.log";

function createLogger(logging = {}) {
  const debugEnabled = Boolean(logging.debug);
  const logFile = path.resolve(logging.file || DEFAULT_LOG_FILE);

  return {
    enabled: debugEnabled,
    file: logFile,
    async debug(message, meta) {
      if (!debugEnabled) {
        return;
      }
      await appendLogLine(logFile, "DEBUG", message, meta);
    }
  };
}

async function appendLogLine(logFile, level, message, meta) {
  const line = formatLogLine(level, message, meta);

  try {
    await fs.mkdir(path.dirname(logFile), { recursive: true });
    await fs.appendFile(logFile, `${line}\n`, "utf8");
  } catch (error) {
    console.error(`写入日志失败：${error.message}`);
  }
}

function formatLogLine(level, message, meta) {
  const payload = meta === undefined ? "" : ` ${JSON.stringify(meta, redactSecret)}`;
  return `${new Date().toISOString()} ${level} ${message}${payload}`;
}

function redactSecret(key, value) {
  const lowerKey = String(key || "").toLowerCase();
  if (lowerKey.includes("apikey") || lowerKey.includes("api_key") || lowerKey.includes("api-key")) {
    return "[REDACTED]";
  }
  if (lowerKey === "authorization" || lowerKey === "x-api-key" || lowerKey === "api-key") {
    return "[REDACTED]";
  }
  return value;
}

module.exports = {
  DEFAULT_LOG_FILE,
  createLogger
};
