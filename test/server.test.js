"use strict";

const http = require("node:http");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createConfigState, createServer, stripAnthropicPrefix } = require("../src/server");
const { normalizeConfig } = require("../src/config");

test("GET / serves the Tailwind admin page with hidden API key control", async (t) => {
  const proxy = createServer(normalizeConfig(
    {
      models: [
        {
          localModelId: "claude",
          remoteModelId: "provider-model",
          remoteBaseUrl: "https://example.com"
        }
      ]
    },
    "/tmp/config.json"
  ));
  await listen(proxy, "127.0.0.1", 0);
  t.after(() => proxy.close());

  const proxyAddress = proxy.address();
  const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /cdn\.tailwindcss\.com/);
  assert.match(html, /模型映射/);
  assert.match(html, /password/);
  assert.match(html, /显示/);
  assert.match(html, /禁用/);
  assert.match(html, /toggleRowKey/);
});

test("POST /api/config saves multi-model JSON and returns keys for local editing", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "llm-model-forward-server-"));
  const configPath = path.join(dir, "config.json");
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const state = await createConfigState(configPath);
  const proxy = createServer(state);
  await listen(proxy, "127.0.0.1", 0);
  t.after(() => proxy.close());

  const proxyAddress = proxy.address();
  const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/api/config`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      models: [
        {
          localModelId: "claude-sonnet",
          remoteBaseUrl: "https://sonnet.example.com",
          remoteApiKey: "sonnet-key",
          remoteModelId: "provider-sonnet"
        },
        {
          localModelId: "claude-haiku",
          remoteBaseUrl: "https://haiku.example.com",
          remoteApiKey: "haiku-key",
          remoteModelId: "provider-haiku"
        }
      ]
    })
  });

  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.config.models.length, 2);
  assert.equal(result.config.models[0].remoteApiKey, "sonnet-key");

  const saved = JSON.parse(await fs.readFile(configPath, "utf8"));
  assert.equal(saved.models[0].remoteApiKey, "sonnet-key");
  assert.equal(saved.models[1].remoteBaseUrl, "https://haiku.example.com");
  assert.equal(saved.models[1].remoteModelId, "provider-haiku");
});

test("POST /v1/messages forwards to mapped Anthropic remote", async (t) => {
  let remoteRequest;

  const remote = http.createServer(async (req, res) => {
    const body = await readBody(req);
    remoteRequest = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: JSON.parse(body)
    };

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: remoteRequest.body.model,
        content: [{ type: "text", text: "ok" }]
      })
    );
  });

  await listen(remote, "127.0.0.1", 0);
  t.after(() => remote.close());

  const remoteAddress = remote.address();
  const config = normalizeConfig(
    {
      models: [
        {
          localModelId: "claude-3-5-sonnet-20241022",
          remoteModelId: "provider-sonnet",
          remoteBaseUrl: `http://127.0.0.1:${remoteAddress.port}`,
          remoteApiKey: "remote-key"
        }
      ]
    },
    "/tmp/config.json"
  );

  const proxy = createServer(config);
  await listen(proxy, "127.0.0.1", 0);
  t.after(() => proxy.close());

  const proxyAddress = proxy.address();
  const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/anthropic/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "local-key",
      "anthropic-beta": "client-beta",
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 8,
      messages: [{ role: "user", content: "hello" }]
    })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "provider-sonnet",
    content: [{ type: "text", text: "ok" }]
  });

  assert.equal(remoteRequest.method, "POST");
  assert.equal(remoteRequest.url, "/v1/messages");
  assert.equal(remoteRequest.headers["x-api-key"], "remote-key");
  assert.equal(remoteRequest.headers["anthropic-beta"], "client-beta");
  assert.equal(remoteRequest.headers["anthropic-version"], "2023-06-01");
  assert.equal(remoteRequest.body.model, "provider-sonnet");
  assert.equal(remoteRequest.body.messages[0].content, "hello");
});

test("forwards arbitrary Anthropic-prefixed paths", async (t) => {
  let remoteRequest;

  const remote = http.createServer(async (req, res) => {
    remoteRequest = {
      method: req.method,
      url: req.url,
      headers: req.headers
    };

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  await listen(remote, "127.0.0.1", 0);
  t.after(() => remote.close());

  const remoteAddress = remote.address();
  const config = normalizeConfig(
    {
      models: [
        {
          localModelId: "claude-default",
          remoteModelId: "provider-default",
          remoteBaseUrl: `http://127.0.0.1:${remoteAddress.port}`,
          remoteApiKey: "remote-key"
        }
      ]
    },
    "/tmp/config.json"
  );

  const proxy = createServer(config);
  await listen(proxy, "127.0.0.1", 0);
  t.after(() => proxy.close());

  const proxyAddress = proxy.address();
  const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/anthropic/v1/models?limit=20`, {
    headers: {
      "anthropic-version": "2023-06-01"
    }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(remoteRequest.method, "GET");
  assert.equal(remoteRequest.url, "/v1/models?limit=20");
  assert.equal(remoteRequest.headers["x-api-key"], undefined);
});

test("replaces auth headers instead of forwarding or inventing them", async (t) => {
  let remoteRequest;

  const remote = http.createServer(async (req, res) => {
    remoteRequest = {
      method: req.method,
      url: req.url,
      headers: req.headers
    };

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  await listen(remote, "127.0.0.1", 0);
  t.after(() => remote.close());

  const remoteAddress = remote.address();
  const config = normalizeConfig(
    {
      models: [
        {
          localModelId: "claude-default",
          remoteModelId: "provider-default",
          remoteBaseUrl: `http://127.0.0.1:${remoteAddress.port}`,
          remoteApiKey: ""
        }
      ]
    },
    "/tmp/config.json"
  );

  const proxy = createServer(config);
  await listen(proxy, "127.0.0.1", 0);
  t.after(() => proxy.close());

  const proxyAddress = proxy.address();
  const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/anthropic/v1/models`, {
    headers: {
      "x-api-key": "local-key",
      authorization: "Bearer local-key"
    }
  });

  assert.equal(response.status, 200);
  assert.equal(remoteRequest.headers["x-api-key"], undefined);
  assert.equal(remoteRequest.headers.authorization, undefined);
});

test("keeps incoming authorization header style when replacing API key", async (t) => {
  let remoteRequest;

  const remote = http.createServer(async (req, res) => {
    remoteRequest = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: JSON.parse(await readBody(req))
    };

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  await listen(remote, "127.0.0.1", 0);
  t.after(() => remote.close());

  const remoteAddress = remote.address();
  const config = normalizeConfig(
    {
      models: [
        {
          localModelId: "claude-bearer",
          remoteModelId: "provider-bearer",
          remoteBaseUrl: `http://127.0.0.1:${remoteAddress.port}`,
          remoteApiKey: "bearer-key"
        }
      ]
    },
    "/tmp/config.json"
  );

  const proxy = createServer(config);
  await listen(proxy, "127.0.0.1", 0);
  t.after(() => proxy.close());

  const proxyAddress = proxy.address();
  const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/anthropic/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": "Bearer local-key"
    },
    body: JSON.stringify({
      model: "claude-bearer",
      max_tokens: 8,
      messages: [{ role: "user", content: "hello" }]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(remoteRequest.headers["x-api-key"], undefined);
  assert.equal(remoteRequest.headers.authorization, "Bearer bearer-key");
  assert.equal(remoteRequest.body.model, "provider-bearer");
});

test("does not add auth header when client sent no auth header", async (t) => {
  let remoteRequest;

  const remote = http.createServer(async (req, res) => {
    remoteRequest = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: JSON.parse(await readBody(req))
    };

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  await listen(remote, "127.0.0.1", 0);
  t.after(() => remote.close());

  const remoteAddress = remote.address();
  const config = normalizeConfig(
    {
      models: [
        {
          localModelId: "claude-no-auth",
          remoteModelId: "provider-no-auth",
          remoteBaseUrl: `http://127.0.0.1:${remoteAddress.port}`,
          remoteApiKey: "secret-key"
        }
      ]
    },
    "/tmp/config.json"
  );

  const proxy = createServer(config);
  await listen(proxy, "127.0.0.1", 0);
  t.after(() => proxy.close());

  const proxyAddress = proxy.address();
  const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/anthropic/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-no-auth",
      max_tokens: 8,
      messages: [{ role: "user", content: "hello" }]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(remoteRequest.headers["x-api-key"], undefined);
  assert.equal(remoteRequest.headers.authorization, undefined);
  assert.equal(remoteRequest.body.model, "provider-no-auth");
});

test("preserves remote redirect response instead of following it", async (t) => {
  const remote = http.createServer((req, res) => {
    res.writeHead(302, {
      location: "/elsewhere",
      "set-cookie": ["a=1; Path=/", "b=2; Path=/"]
    });
    res.end("redirect");
  });

  await listen(remote, "127.0.0.1", 0);
  t.after(() => remote.close());

  const remoteAddress = remote.address();
  const config = normalizeConfig(
    {
      models: [
        {
          localModelId: "claude-default",
          remoteModelId: "provider-default",
          remoteBaseUrl: `http://127.0.0.1:${remoteAddress.port}`
        }
      ]
    },
    "/tmp/config.json"
  );

  const proxy = createServer(config);
  await listen(proxy, "127.0.0.1", 0);
  t.after(() => proxy.close());

  const proxyAddress = proxy.address();
  const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/anthropic/v1/models`, {
    redirect: "manual"
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/elsewhere");
  assert.deepEqual(response.headers.getSetCookie(), ["a=1; Path=/", "b=2; Path=/"]);
});

test("preserves remote status text", async (t) => {
  const remote = http.createServer((req, res) => {
    res.writeHead(418, "Custom Remote Status", { "content-type": "text/plain" });
    res.end("teapot");
  });

  await listen(remote, "127.0.0.1", 0);
  t.after(() => remote.close());

  const remoteAddress = remote.address();
  const config = normalizeConfig(
    {
      models: [
        {
          localModelId: "claude-default",
          remoteModelId: "provider-default",
          remoteBaseUrl: `http://127.0.0.1:${remoteAddress.port}`
        }
      ]
    },
    "/tmp/config.json"
  );

  const proxy = createServer(config);
  await listen(proxy, "127.0.0.1", 0);
  t.after(() => proxy.close());

  const proxyAddress = proxy.address();
  const result = await httpGetRaw(`http://127.0.0.1:${proxyAddress.port}/anthropic/v1/models`);

  assert.equal(result.statusCode, 418);
  assert.equal(result.statusMessage, "Custom Remote Status");
  assert.equal(result.body, "teapot");
});

test("returns JSON error when remote connection fails before headers", async (t) => {
  const closedRemote = http.createServer();
  await listen(closedRemote, "127.0.0.1", 0);
  const remoteAddress = closedRemote.address();
  await closeServer(closedRemote);

  const config = normalizeConfig(
    {
      models: [
        {
          localModelId: "claude-default",
          remoteModelId: "provider-default",
          remoteBaseUrl: `http://127.0.0.1:${remoteAddress.port}`
        }
      ]
    },
    "/tmp/config.json"
  );

  const proxy = createServer(config);
  await listen(proxy, "127.0.0.1", 0);
  t.after(() => proxy.close());

  const proxyAddress = proxy.address();
  const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/anthropic/v1/models`);
  const error = await response.json();

  assert.equal(response.status, 502);
  assert.equal(error.type, "error");
  assert.equal(error.error.type, "api_error");
});

test("rewrites nested model fields for message batches", async (t) => {
  let remoteRequest;

  const remote = http.createServer(async (req, res) => {
    const body = await readBody(req);
    remoteRequest = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: JSON.parse(body)
    };

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  await listen(remote, "127.0.0.1", 0);
  t.after(() => remote.close());

  const remoteAddress = remote.address();
  const config = normalizeConfig(
    {
      models: [
        {
          localModelId: "claude-local",
          remoteModelId: "provider-batch-model",
          remoteBaseUrl: `http://127.0.0.1:${remoteAddress.port}`,
          remoteApiKey: "remote-key"
        }
      ]
    },
    "/tmp/config.json"
  );

  const proxy = createServer(config);
  await listen(proxy, "127.0.0.1", 0);
  t.after(() => proxy.close());

  const proxyAddress = proxy.address();
  const response = await fetch(`http://127.0.0.1:${proxyAddress.port}/anthropic/v1/messages/batches`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "local-key",
      "authorization": "Bearer local-key",
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      requests: [
        {
          custom_id: "one",
          params: {
            model: "claude-local",
            max_tokens: 8,
            messages: [{ role: "user", content: "hello" }]
          }
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(remoteRequest.url, "/v1/messages/batches");
  assert.equal(remoteRequest.headers["x-api-key"], "remote-key");
  assert.equal(remoteRequest.headers.authorization, "Bearer remote-key");
  assert.equal(remoteRequest.body.requests[0].params.model, "provider-batch-model");
});

test("stripAnthropicPrefix preserves path and query", () => {
  assert.equal(stripAnthropicPrefix("/anthropic/v1/messages"), "/v1/messages");
  assert.equal(stripAnthropicPrefix("/anthropic/v1/models?limit=20"), "/v1/models?limit=20");
  assert.equal(stripAnthropicPrefix("/anthropic"), "/");
});

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function httpGetRaw(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8")
        });
      });
    });
    req.on("error", reject);
  });
}
