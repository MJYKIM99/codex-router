import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chatgptWebModels } from "../src/chatgpt-web-capabilities.mjs";
import { readChatgptWebBridgeConfig } from "../src/chatgpt-web-launcher.mjs";
import { routedModel } from "../src/catalog.mjs";
import { discoverProviderModels } from "../src/model-discovery.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/chatgpt-web/6.1.0.json", import.meta.url)));
test("saved capability contract matches all 32 upstream account/context combinations", () => {
  for (const { config, models } of fixture.cases) {
    const actual = chatgptWebModels(config);
    assert.deepEqual(actual.map(model => ({
      id: model.upstreamId, efforts: model.reasoningLevels.map(level => level.effort),
      defaultEffort: model.defaultEffort, contextWindow: model.contextWindow,
      autoCompact: model.autoCompact, legacy: model.legacy,
    })), models, JSON.stringify(config));
    for (const model of actual) {
      assert.deepEqual(model.inputModalities, config.browserInteractionMode === "manual" ? ["text"] : ["text", "image"]);
    }
  }
});

test("unverified versions and incomplete capabilities do not invent a catalog", () => {
  const config = fixture.cases[0].config;
  for (const invalid of [undefined, {}, { ...config, releaseVersion: "6.2.0" },
    { ...config, solAvailable: undefined }, { ...config, mode: "unknown" },
    { ...config, browserInteractionMode: "manual", experimentalBiggerContext: true }]) {
    assert.throws(() => chatgptWebModels(invalid));
  }
});

test("reading capabilities exposes only safe fields from the launcher's private config", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "web-capabilities-"));
  const configPath = path.join(root, "config.json");
  try {
    writeFileSync(configPath, JSON.stringify({ ...fixture.cases[0].config,
      controlToken: "PRIVATE_TOKEN", tunnel: { secret: "PRIVATE_TUNNEL" }, contextWindow: 256000 }));
    const config = readChatgptWebBridgeConfig({ configPath });
    assert.equal(JSON.stringify(config).includes("PRIVATE"), false);
    assert.equal(chatgptWebModels(config)[0].contextWindow, 1050000);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Web catalog uses its own compaction budget and native tool surface", () => {
  const model = chatgptWebModels(fixture.cases[0].config)[0];
  const published = routedModel({ tool_mode: "code", comp_hash: "native-hash" }, {
    ...model, provider: "chatgpt-web", slug: model.upstreamId, compHash: "router-hash",
  });
  assert.equal(published.comp_hash, undefined);
  assert.equal(published.tool_mode, null);
  assert.equal(published.effective_context_window_percent, 100);
  assert.equal(published.multi_agent_version, "v1");
});

test("shared discovery reads the same saved contract without fetching an account catalog", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "web-discovery-"));
  const previous = process.env.CODEX_CHATGPT_WEB_HOME;
  try {
    process.env.CODEX_CHATGPT_WEB_HOME = root;
    writeFileSync(path.join(root, "config.json"), JSON.stringify(fixture.cases[0].config));
    const result = await discoverProviderModels("chatgpt-web", {
      refresh: true, loadPayload: () => { throw new Error("must not fetch account catalog"); },
    });
    assert.deepEqual(result.discovered, fixture.cases[0].models.map(model => model.id));
    assert.match(result.note, /saved launcher capabilities/);
  } finally {
    if (previous === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
