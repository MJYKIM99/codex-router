import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const callerSecret = "chatgpt-web-doctor-caller-capability-0123456789";
const routerBaseUrl = `http://127.0.0.1:46193/_codex-router/${callerSecret}/v1`;
const launcherBaseUrl = "http://127.0.0.1:17841/v1";

function writeCodexStub(directory) {
  const windows = process.platform === "win32";
  const target = path.join(directory, windows ? "codex-doctor.cmd" : "codex-doctor");
  writeFileSync(
    target,
    windows
      ? `@echo off\r\nif "%1"=="--version" (echo codex-cli 99.0.0& exit /b 0)\r\nif "%1"=="login" exit /b 0\r\nif "%1"=="debug" (echo {"models":[]}& exit /b 0)\r\nexit /b 1\r\n`
      : `#!/bin/sh
case "$1" in
  --version) echo 'codex-cli 99.0.0' ;;
  login) exit 0 ;;
  debug) printf '%s\\n' '{"models":[]}' ;;
  *) exit 1 ;;
esac
`,
    { mode: 0o755 },
  );
  return target;
}

function writeJournal(journalHome, journal) {
  const journalPath = path.join(journalHome, "codex", "integration-journal.json");
  mkdirSync(path.dirname(journalPath), { recursive: true, mode: 0o700 });
  writeFileSync(journalPath, `${JSON.stringify(journal)}\n`, { mode: 0o600 });
}

// Every case redirects the launcher's own home too: the check reads a journal
// written by another program, and a maintainer who really has the launcher
// installed must not be able to change what this fixture reports.
async function runDoctor({
  baseUrl = routerBaseUrl,
  journal = null,
  journalHome = "fresh",
  enabledProviders = null,
  bridgeUrl = null,
  bridgeConfig = null,
} = {}) {
  const codexHome = mkdtempSync(path.join(os.tmpdir(), "codex-router-doctor-cgw-"));
  // "fresh" is a launcher data directory that exists with no journal in it;
  // "absent" is no directory at all. Those are the two states an operator must
  // be able to tell apart.
  const journalHomePath = journalHome === "absent"
    ? path.join(root, "definitely-absent-launcher-home")
    : mkdtempSync(path.join(os.tmpdir(), "codex-router-cgw-home-"));
  const stateDir = path.join(codexHome, "router-state");
  const configPath = path.join(codexHome, "config.toml");
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  // The live shape of a router install: the launcher's managed key at the root,
  // plus the provider table the router's own block names.
  writeFileSync(
    configPath,
    `model_provider = "custom"\nopenai_base_url = ${JSON.stringify(baseUrl)}\n\n[model_providers.custom]\nname = "Codex Router"\nbase_url = ${JSON.stringify(baseUrl)}\nwire_api = "responses"\n`,
    { mode: 0o600 },
  );
  if (enabledProviders) {
    writeFileSync(
      path.join(stateDir, "enabled-providers.json"),
      `${JSON.stringify({ version: 1, providers: enabledProviders })}\n`,
      { mode: 0o600 },
    );
  }
  if (journal) writeJournal(journalHomePath, journal(configPath));
  if (bridgeConfig) writeFileSync(path.join(journalHomePath, "config.json"), JSON.stringify(bridgeConfig), { mode: 0o600 });
  const result = await promisify(execFile)(process.execPath, [path.join(root, "src", "doctor.mjs"), "--json"], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      CODEX_BIN: writeCodexStub(codexHome),
      CODEX_HOME: codexHome,
      CODEX_CHATGPT_WEB_HOME: journalHomePath,
      CODEX_ROUTER_PORT: "46193",
      CODEX_ROUTER_SERVICE_PLATFORM: "test-fixture",
      CODEX_ROUTER_STATE_DIR: stateDir,
      ...(bridgeUrl ? { MODEL_ROUTER_CHATGPT_WEB_BASE_URL: bridgeUrl } : {}),
      MODEL_ROUTER_STATE_DIR: stateDir,
      MODEL_ROUTER_TARGET: "codex",
    },
  }).catch(error => ({ stdout: error.stdout, stderr: error.stderr, status: error.code }));
  rmSync(codexHome, { recursive: true, force: true });
  if (journalHome !== "absent") rmSync(journalHomePath, { recursive: true, force: true });
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(`doctor did not print JSON (status ${result.status}): ${result.stderr}`);
  }
  const check = parsed.checks.find((entry) => entry.name === "ChatGPT Web launcher");
  assert.ok(check, `doctor did not report the launcher check: ${result.stdout}`);
  const bridge = parsed.checks.find((entry) => entry.name === "ChatGPT Web bridge");
  const capabilities = parsed.checks.find((entry) => entry.name === "ChatGPT Web capabilities");
  return { check, bridge, capabilities, configPath, stdout: result.stdout };
}

test("doctor reports the reviewed 6.1.9 capability version and GPT-6 routes", { timeout: 40_000 }, async () => {
  const server = http.createServer((_req, res) => res.end(JSON.stringify({
    service: "codex-chatgpt-web", status: "ok", version: "6.1.9", mode: "full",
    accepting_turns: true, active_http_turns: 0, active_browser_turns: 0,
  })));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await runDoctor({
      enabledProviders: ["chatgpt-web"], bridgeUrl: `http://127.0.0.1:${server.address().port}/v1`,
      bridgeConfig: {
        version: 3, releaseVersion: "6.1.9", mode: "full", subagentProtocol: "compatibility-v1",
        browserInteractionMode: "automatic", solAvailable: true, proAvailable: true,
        extraHighAvailable: true, experimentalBiggerContext: true, zeroRiskProEnabled: false,
      },
    });
    assert.equal(result.bridge?.status, "ok");
    assert.equal(result.capabilities?.status, "ok");
    assert.match(result.capabilities.detail, /^6\.1\.9 contract; 6 current models;/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test(
  "an installed launcher that never installed its Codex integration is not called absent",
  { timeout: 40_000 },
  async () => {
    const { check } = await runDoctor();
    assert.equal(check.status, "ok");
    assert.match(check.detail, /never installed its Codex route integration/);
  },
);

test(
  "no launcher at all is reported as not installed",
  { timeout: 40_000 },
  async () => {
    const { check } = await runDoctor({ journalHome: "absent" });
    assert.equal(check.status, "ok");
    assert.match(check.detail, /^not installed \(/);
  },
);

test(
  "a launcher owned by its own profile is reported as healthy, not as a threat",
  { timeout: 40_000 },
  async () => {
    const otherProfile = path.join(os.tmpdir(), "codex-router-cgw-self", "config.toml");
    const { check } = await runDoctor({
      journal: () => ({
        version: 10,
        active: true,
        configPath: otherProfile,
        installed: { openai_base_url: launcherBaseUrl },
      }),
    });
    assert.equal(check.status, "ok");
    assert.match(check.detail, /not this profile/);
  },
);

test(
  "a launcher still targeting the router's own profile warns before it takes the route",
  { timeout: 40_000 },
  async () => {
    const { check } = await runDoctor({
      journal: (configPath) => ({
        version: 10,
        active: true,
        configPath,
        installed: { openai_base_url: launcherBaseUrl },
      }),
    });
    assert.equal(check.status, "warn");
    assert.match(check.detail, /still targets/);
  },
);

test(
  "a journal that names no profile warns instead of reporting health",
  { timeout: 40_000 },
  async () => {
    const { check } = await runDoctor({
      journal: () => ({
        version: 10,
        active: true,
        installed: { openai_base_url: launcherBaseUrl },
      }),
    });
    assert.equal(check.status, "warn");
    assert.match(check.detail, /records no Codex profile/);
  },
);

test(
  "a disconnected journal that still targets this profile warns",
  { timeout: 40_000 },
  async () => {
    const { check } = await runDoctor({
      journal: (configPath) => ({
        version: 10,
        active: false,
        configPath,
        installed: { openai_base_url: launcherBaseUrl },
      }),
    });
    assert.equal(check.status, "warn");
    assert.match(check.detail, /still targets/);
  },
);

test(
  "a live takeover fails, and the check never prints the caller capability",
  { timeout: 40_000 },
  async () => {
    const { check, stdout } = await runDoctor({
      // A journal can record any baseline, including the router's own
      // capability-bearing URL. Matching it against the live route is the
      // takeover path, and it is the one path that echoes a route back -- the
      // shape that must arrive redacted.
      journal: (configPath) => ({
        version: 10,
        active: true,
        configPath,
        installed: { openai_base_url: routerBaseUrl },
      }),
    });
    assert.equal(check.status, "fail");
    assert.equal(stdout.includes(callerSecret), false, "doctor leaked the caller capability");
  },
);

test(
  "one route written two ways is still a takeover",
  { timeout: 40_000 },
  async () => {
    const { check } = await runDoctor({
      journal: (configPath) => ({
        version: 10,
        active: true,
        configPath,
        installed: { openai_base_url: `${launcherBaseUrl}/` },
      }),
      baseUrl: launcherBaseUrl,
    });
    assert.equal(check.status, "fail");
  },
);

test(
  "a router that is not offering web models does not pay for a bridge probe",
  { timeout: 40_000 },
  async () => {
    const { bridge } = await runDoctor({ enabledProviders: ["deepseek"] });
    assert.equal(bridge, undefined, "the probe ran without chatgpt-web selected");
  },
);

test(
  "a selected web route reports the bridge it would actually reach",
  { timeout: 40_000 },
  async () => {
    // Something is listening: the check says which address it found, so an
    // operator can see it is their own bridge and not a leftover process.
    const server = http.createServer((req, res) => {
      assert.equal(req.url, "/healthz");
      res.end(JSON.stringify({service:"codex-chatgpt-web", status:"ok", version:"6.1.0", mode:"full",
        accepting_turns:true, active_http_turns:0, active_browser_turns:0}));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    try {
      const listening = await runDoctor({
        enabledProviders: ["chatgpt-web"],
        bridgeUrl: `http://127.0.0.1:${port}/v1`,
      });
      assert.equal(listening.bridge?.status, "ok");
      assert.match(listening.bridge.detail, new RegExp(`127\\.0\\.0\\.1:${port}`));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    // And nothing listening is a warning, not a silent first-turn failure.
    const stopped = await runDoctor({
      enabledProviders: ["chatgpt-web"],
      bridgeUrl: `http://127.0.0.1:${port}/v1`,
    });
    assert.equal(stopped.bridge?.status, "warn");
    assert.match(stopped.bridge.detail, /health endpoint unreachable/);
    assert.match(stopped.bridge.fix, /codex-chatgpt-web serve/);
  },
);
