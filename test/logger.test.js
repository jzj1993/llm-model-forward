"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createLogger } = require("../src/logger");

test("debug logger writes redacted lines only when enabled", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "llm-model-forward-log-"));
  const logFile = path.join(dir, "debug.log");
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  await createLogger({ debug: false, file: logFile }).debug("不会写入", { remoteApiKey: "secret" });
  await assert.rejects(() => fs.readFile(logFile, "utf8"), /ENOENT/);

  await createLogger({ debug: true, file: logFile }).debug("转发失败", {
    remoteUrl: "https://example.com/v1/messages",
    remoteApiKey: "secret",
    authorization: "Bearer secret"
  });

  const log = await fs.readFile(logFile, "utf8");
  assert.match(log, /DEBUG 转发失败/);
  assert.match(log, /https:\/\/example\.com\/v1\/messages/);
  assert.doesNotMatch(log, /secret/);
  assert.match(log, /\[REDACTED\]/);
});
