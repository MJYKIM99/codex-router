import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";

import { callerBaseUrl } from '../src/caller-auth.mjs';
import { openPort } from "./port-pool.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INTERNAL_KEY = "test-internal-service-key-with-sufficient-length";
const CALLER_KEY = "test-router-caller-capability-with-sufficient-length";

function routerBase(port) {
  return callerBaseUrl(port, CALLER_KEY);
}

function json(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(body.length),
  });
  response.end(body);
}

async function bodyJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  // The router compresses large bodies on the way to the native backend, the
  // way Codex itself does on the way in, so a mock backend has to decode one.
  const body = request.headers["content-encoding"] === "zstd" ? zstdDecompressSync(raw) : raw;
  return JSON.parse(body.toString("utf8"));
}

async function mockServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(typeof address === "object" && address);
  return { server, port: address.port };
}

function run(script, env, { nodeArgs = [] } = {}) {
  // Isolate from the user's real router state (e.g. native-aliases.json)
  // unless the test provides its own state directory.
  const stateIsolation =
    env?.MODEL_ROUTER_STATE_DIR || env?.CODEX_ROUTER_STATE_DIR
      ? {}
      : { MODEL_ROUTER_STATE_DIR: mkdtempSync(path.join(os.tmpdir(), "routing-state-")) };
  const child = spawn(process.execPath, [...nodeArgs, path.join(root, "src", script)], {
    cwd: root,
    env: {
      ...process.env,
      ...stateIsolation,
      CODEX_ROUTER_CALLER_KEY: CALLER_KEY,
      CODEX_ROUTER_INTERNAL_KEY: INTERNAL_KEY,
      KIMI_INTERNAL_KEY: INTERNAL_KEY,
      CODEX_ROUTER_SHOW_ALL_MODELS: "1",
      ...env,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.setEncoding("utf8");
  let errors = "";
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  child.testErrors = () => errors;
  return child;
}

async function waitFor(url, child, headers = {}) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Child exited early (${child.exitCode}): ${child.testErrors()}`);
    }
    try {
      const response = await fetch(url, { headers });
      if (response.ok) return;
    } catch {
      // The child has not bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${url}: ${child.testErrors()}`);
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

test("direct bridge preserves SSE, authority, replay and owns both compaction protocols", async () => {
  const testRoot = mkdtempSync(path.join(os.tmpdir(), "chatgpt-web-direct-route-"));
  const userModelsPath = path.join(testRoot, "user-models.json");
  writeFileSync(userModelsPath, JSON.stringify({
    version: 1,
    models: [{
      slug: "chatgpt-web/light",
      gatewayModel: "chatgpt-web-light",
      upstreamModel: "chatgpt-web/light",
      provider: "chatgpt-web",
      listed: true,
      displayName: "ChatGPT Web — Instant",
      description: "Test ChatGPT Web direct Responses route.",
      priority: 100,
      reasoningLevels: [{ effort: "low", description: "Quick reasoning" }],
      defaultEffort: "low",
      contextWindow: 41_000,
      autoCompact: 32_000,
      inputModalities: ["text", "image"],
      compHash: "chatgpt-web-light-routing-test-v1"
    }],
  }));
  const bridgeRequests = [];
  const originalText = "Example: <think>literal tag content</think> finish";
  const item = { id: "msg_web", type: "message", role: "assistant", status: "completed", content: [{type:"output_text", text:originalText}] };
  const tool = {id:"call_web", type:"function_call", name:"collaboration.spawn_agent",
    call_id:"web_child", arguments:'{"task_name":"owned_by_bridge"}', status:"completed"};
  const frames = [
    {type:"response.output_item.added",output_index:0,item:{...item,status:"in_progress",content:[]}},
    {type:"response.content_part.added",output_index:0,item_id:item.id,content_index:0,part:{type:"output_text",text:""}},
    {type:"response.output_text.delta",output_index:0,item_id:item.id,content_index:0,delta:originalText},
    {type:"response.output_text.done",output_index:0,item_id:item.id,content_index:0,text:originalText},
    {type:"response.output_item.done",output_index:0,item},
    {type:"response.output_item.added",output_index:1,item:{...tool,status:"in_progress",arguments:""}},
    {type:"response.function_call_arguments.delta",output_index:1,item_id:tool.id,delta:tool.arguments},
    {type:"response.output_item.done",output_index:1,item:tool},
    {type:"response.completed",response:{id:"resp_web",object:"response",status:"completed",model:"chatgpt-web/light",output:[item,tool],usage:{input_tokens:0,output_tokens:30,total_tokens:30}}}
  ];
  const exactTurnResponse = frames.map(x=>`event: ${x.type}\ndata: ${JSON.stringify(x)}\n\n`).join("");
  let closedAbort;
  const abortClosed = new Promise(resolve => { closedAbort = resolve; });
  const bridge = await mockServer(async (request, response) => {
    const body = await bodyJson(request);
    bridgeRequests.push({ url: request.url, headers: request.headers, body });
    if (body.metadata?.abortTest) {
      response.on("close", closedAbort);
      response.writeHead(200, {"Content-Type":"text/event-stream"});
      response.write(": bridge started\n\n");
      return;
    }
    if (body.metadata?.errorTest) {
      json(response, 502, {error:{code:"upstream_server_error", message:"browser error", retryable:true}});
      return;
    }
    if (request.url.startsWith("/v1/responses/compact")) {
      json(response, 409, {
        error: {
          type: "invalid_request_error",
          message: "browser bridge retained-source compaction is unavailable",
        },
      });
      return;
    }
    if (body.input?.at(-1)?.type === "compaction_trigger") {
      json(response, 200, { output: [{ type: "compaction", encrypted_content: "ocx1:bridge-owned" }] });
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(exactTurnResponse);
  });
  const gatewayRequests = [];
  const gateway = await mockServer(async (request, response) => {
    gatewayRequests.push(request.url);
    json(response, 200, { object: "response", status: "completed", output: [] });
  });
  const routerPort = await openPort();
  const router = run("router.mjs", {
    CODEX_ROUTER_PORT: String(routerPort),
    CODEX_ROUTER_STATE_DIR: path.join(testRoot, "state"),
    MODEL_ROUTER_USER_MODELS: userModelsPath,
    MODEL_ROUTER_CHATGPT_WEB_BASE_URL: `http://127.0.0.1:${bridge.port}/v1`,
    CODEX_ROUTER_GATEWAY_BASE_URL: `http://127.0.0.1:${gateway.port}/v1`,
    CODEX_ROUTER_QUIET: "1",
  });

  try {
    await waitFor(`${routerBase(routerPort)}/models`, router);
    const turnPayload = {
      model: "chatgpt-web/light",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
      tools: [{ type: "function", name: "workspace_tool", parameters: { type: "object" } }],
      client_metadata: { "x-codex-turn-metadata": "body-turn-authority" },
      stream: true,
    };
    const turn = await fetch(`${routerBase(routerPort)}/responses`, {
      method: "POST",
      headers: {
        Authorization: "Bearer CHATGPT_SESSION_MUST_NOT_LEAK",
        "Content-Type": "application/json",
        "X-Codex-Turn-Metadata": "header-turn-authority",
      },
      body: JSON.stringify(turnPayload),
    });
    const turnText = await turn.text();
    assert.equal(turn.status, 200, turnText);
    assert.equal(turnText, exactTurnResponse, "the direct bridge owns every response frame");
    assert.equal(bridgeRequests.length, 1);
    assert.equal(bridgeRequests[0].url, "/v1/responses");
    assert.equal(bridgeRequests[0].headers.authorization, "Bearer local");
    assert.equal(bridgeRequests[0].headers["x-codex-turn-metadata"], "header-turn-authority");
    assert.deepEqual(bridgeRequests[0].body, turnPayload);
    assert.deepEqual(gatewayRequests, []);

    const beforeV2 = bridgeRequests.length;
    const v2 = await fetch(`${routerBase(routerPort)}/responses`, {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({...turnPayload, stream:false, input:[{role:"user",content:"x".repeat(20000)},{type:"compaction_trigger"}]})
    });
    const v2Body = await v2.json();
    assert.equal(v2.status, 200);
    assert.equal(bridgeRequests.length - beforeV2, 1);
    assert.equal(v2Body.output[0].encrypted_content, "ocx1:bridge-owned");
    const replayPayload = {...turnPayload, input:[
      {type:"compaction", encrypted_content:"ocx1:opaque-browser-history"},
      {type:"reasoning", encrypted_content:"opaque-memento", summary:[]},
      ...turnPayload.input,
    ]};
    const replay = await fetch(`${routerBase(routerPort)}/responses`, {
      method: "POST", headers: {"Content-Type":"application/json"}, body:JSON.stringify(replayPayload),
    });
    assert.equal(await replay.text(), exactTurnResponse);
    assert.deepEqual(bridgeRequests.at(-1).body, replayPayload);
    const compact = await fetch(`${routerBase(routerPort)}/responses/compact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...turnPayload, stream: false }),
    });
    assert.equal(compact.status, 409);
    assert.match(await compact.text(), /retained-source compaction is unavailable/);
    assert.equal(bridgeRequests.length, 4, "a failed browser compaction was sent more than once");
    assert.equal(bridgeRequests.at(-1).url, "/v1/responses/compact");
    const failed = await fetch(`${routerBase(routerPort)}/responses`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({...turnPayload,metadata:{errorTest:true}}),
    });
    assert.equal(failed.status,502);
    assert.deepEqual(await failed.json(), {error:{code:"upstream_server_error",message:"browser error",retryable:true}});
    assert.equal(bridgeRequests.length,5,"a retryable bridge error must not cause an extra browser turn");
    const controller = new AbortController();
    const streaming = await fetch(`${routerBase(routerPort)}/responses`, {
      method:"POST", headers:{"Content-Type":"application/json"}, signal:controller.signal,
      body:JSON.stringify({...turnPayload,metadata:{abortTest:true}}),
    });
    assert.equal(streaming.status,200);
    controller.abort();
    let timeout;
    try {
      await Promise.race([abortClosed,new Promise((resolve,reject) => {
        timeout=setTimeout(()=>reject(new Error("caller cancellation did not close the bridge request")),2000);
      })]);
    } finally { clearTimeout(timeout); }
    assert.equal(bridgeRequests.length,6);
    assert.deepEqual(gatewayRequests, []);
  } finally {
    await stopChild(router);
    await closeServer(bridge.server);
    await closeServer(gateway.server);
    rmSync(testRoot, { recursive: true, force: true });
  }
});
