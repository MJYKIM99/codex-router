import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import {
  bridgeAddress,
  chatgptWebHome,
  chatgptWebJournalPath,
  chatgptWebOwnershipVerdict,
  probeBridgeListener,
  readChatgptWebRouteClaim,
  sameCodexProfile,
} from "../src/chatgpt-web-launcher.mjs";

const root = mkdtempSync(path.join(os.tmpdir(), "chatgpt-web-launcher-"));
const configPath = path.join(root, "codex", "config.toml");

after(() => rmSync(root, { recursive: true, force: true }));

function writeJournal(name, journal) {
  const home = path.join(root, name);
  const journalPath = path.join(home, "codex", "integration-journal.json");
  mkdirSync(path.dirname(journalPath), { recursive: true });
  writeFileSync(journalPath, typeof journal === "string" ? journal : JSON.stringify(journal));
  return { home, journalPath };
}

function verdictFor(journal, { baseUrls = [], name = "case" } = {}) {
  const { journalPath } = writeJournal(name, journal);
  const claim = readChatgptWebRouteClaim({ environment: {}, configPath, journalPath });
  return { claim, verdict: chatgptWebOwnershipVerdict({ claim, codexBaseUrls: baseUrls }) };
}

test("the launcher keeps its own home, independent of CODEX_HOME", () => {
  assert.equal(
    chatgptWebHome({ CODEX_CHATGPT_WEB_HOME: "/tmp/launcher-home", CODEX_HOME: "/tmp/codex" }),
    "/tmp/launcher-home",
  );
  // The Codex profile must not move the launcher's journal.
  assert.equal(
    chatgptWebHome({ CODEX_HOME: "/tmp/codex" }),
    path.join(os.homedir(), ".codex-chatgpt-web"),
  );
  assert.equal(
    chatgptWebJournalPath({ CODEX_CHATGPT_WEB_HOME: "/tmp/launcher-home" }),
    "/tmp/launcher-home/codex/integration-journal.json",
  );
  assert.equal(chatgptWebHome({ CODEX_CHATGPT_WEB_HOME: "~/custom" }), path.join(os.homedir(), "custom"));
});

test("no journal is an absent claim rather than a broken one", () => {
  const claim = readChatgptWebRouteClaim({
    environment: { CODEX_CHATGPT_WEB_HOME: path.join(root, "never-installed") },
    configPath,
  });
  assert.equal(claim.installed, false);
  assert.equal(claim.homePresent, false);
  assert.deepEqual(chatgptWebOwnershipVerdict({ claim }), { state: "absent" });
});

test("an installed launcher that never installed its Codex integration says so", () => {
  // The two states read very differently to an operator: one is "you do not
  // have this program", the other is "you have it, and it has not touched
  // Codex". The launcher's data directory is what tells them apart.
  const home = path.join(root, "installed-without-integration");
  mkdirSync(path.join(home, "versions", "6.0.0-darwin-arm64"), { recursive: true });
  const environment = { CODEX_CHATGPT_WEB_HOME: home };
  const claim = readChatgptWebRouteClaim({ environment, configPath });
  assert.equal(claim.installed, false);
  assert.equal(claim.homePresent, true);
  assert.equal(claim.journalPath, chatgptWebJournalPath(environment));
  assert.deepEqual(chatgptWebOwnershipVerdict({ claim }), { state: "absent" });
});

test("a damaged journal reports its own state instead of throwing", () => {
  const { claim, verdict } = verdictFor("{ not json", { name: "damaged" });
  assert.equal(claim.damaged, true);
  assert.equal(verdict.state, "unreadable");
  assert.equal(claim.journalPath.endsWith("integration-journal.json"), true);
});

test("something that is not a regular file is refused rather than read", () => {
  // A FIFO here would block the whole diagnostic run, so the check reports the
  // state instead of opening it. A directory proves the same guard portably.
  const home = path.join(root, "not-a-file");
  const journalPath = path.join(home, "codex", "integration-journal.json");
  mkdirSync(journalPath, { recursive: true });
  const claim = readChatgptWebRouteClaim({ environment: {}, configPath, journalPath });
  assert.equal(claim.installed, true);
  assert.equal(claim.damaged, true);
  assert.deepEqual(chatgptWebOwnershipVerdict({ claim }), { state: "unreadable" });
});

test("a journal that names no profile is unverifiable, never healthy", () => {
  // "Aimed somewhere else" is the answer that keeps the router quiet, so the
  // one shape that cannot support it must not produce it.
  for (const journal of [
    { version: 10, active: true, installed: { openai_base_url: "http://127.0.0.1:17841/v1" } },
    { version: 3, active: true },
  ]) {
    const { verdict } = verdictFor(journal, { baseUrls: [], name: `no-path-${journal.version}` });
    assert.equal(verdict.state, "unverifiable");
  }
});

test("an active integration on this profile whose route is live is a takeover", () => {
  const live = "http://127.0.0.1:17841/v1";
  const { verdict } = verdictFor({
    version: 10,
    active: true,
    configPath,
    installed: { openai_base_url: live },
  }, { baseUrls: [live], name: "taken-over" });
  assert.equal(verdict.state, "taken-over");
});

test("an active integration that has not won the route yet is latent, not a takeover", () => {
  const { verdict } = verdictFor({
    version: 10,
    active: true,
    configPath,
    installed: { openai_base_url: "http://127.0.0.1:17841/v1" },
  }, { baseUrls: ["http://127.0.0.1:4201/secret/v1"], name: "latent" });
  assert.equal(verdict.state, "latent");
});

test("the two loopback route spellings of one route are one route", () => {
  const { verdict } = verdictFor({
    version: 10,
    active: true,
    configPath,
    installed: { openai_base_url: "http://localhost:17841/v1/" },
  }, { baseUrls: ["http://127.0.0.1:17841/v1"], name: "spelling" });
  assert.equal(verdict.state, "taken-over");
});

test("a journal that does not say it is inactive is not read as inactive", () => {
  for (const active of [1, "true", undefined]) {
    const { verdict } = verdictFor({
      version: 3,
      active,
      configPath,
      installed: { openai_base_url: "http://127.0.0.1:17841/v1" },
    }, { baseUrls: ["http://127.0.0.1:4201/secret/v1"], name: `active-${String(active)}` });
    assert.equal(verdict.state, "latent");
  }
});

test("a takeover is never claimed without the recorded route as evidence", () => {
  // An older or unrecognised journal baseline still targets this profile, so
  // the honest answer is the latent warning, not a takeover this cannot prove.
  const { verdict } = verdictFor({
    version: 3,
    active: true,
    configPath,
    installed: {},
  }, { baseUrls: ["http://127.0.0.1:17841/v1"], name: "no-baseline" });
  assert.equal(verdict.state, "latent");
});

test("a disconnected journal that still targets this profile is reported", () => {
  const { verdict } = verdictFor({
    version: 10,
    active: false,
    configPath,
    installed: { openai_base_url: "http://127.0.0.1:17841/v1" },
  }, { name: "disconnected" });
  assert.equal(verdict.state, "disconnected");
});

test("a launcher pointed at its own profile is the healthy arrangement", () => {
  const { verdict } = verdictFor({
    version: 10,
    active: true,
    configPath: path.join(root, "isolated-codex", "config.toml"),
    installed: { openai_base_url: "http://127.0.0.1:17841/v1" },
  }, { baseUrls: ["http://127.0.0.1:4201/secret/v1"], name: "other-profile" });
  assert.equal(verdict.state, "other-profile");
});

test("a redundant path spelling still counts as the same Codex profile", () => {
  const { verdict } = verdictFor({
    version: 10,
    active: true,
    configPath: path.join(root, "codex", ".", "config.toml"),
    installed: { openai_base_url: "http://127.0.0.1:17841/v1" },
  }, { baseUrls: ["http://127.0.0.1:4201/secret/v1"], name: "same-profile" });
  assert.equal(verdict.state, "latent");
});

test("one profile written two ways is one profile", () => {
  const canonical = path.join(os.homedir(), ".codex", "config.toml");
  assert.equal(sameCodexProfile("~/.codex/config.toml", canonical), true);
  assert.equal(sameCodexProfile(path.join(os.homedir(), ".codex", ".", "config.toml"), canonical), true);
  assert.equal(sameCodexProfile("", canonical), false);
  assert.equal(sameCodexProfile(undefined, canonical), false);
  assert.equal(sameCodexProfile(path.join(os.homedir(), ".codex-cgw", "config.toml"), canonical), false);
});

test("the bridge address is taken from the route the router would use", () => {
  assert.deepEqual(bridgeAddress("http://127.0.0.1:17841/v1"), { host: "127.0.0.1", port: 17841 });
  assert.deepEqual(bridgeAddress("https://bridge.example/v1"), { host: "bridge.example", port: 443 });
  // A refusal to answer is the right answer for a value the router cannot use.
  assert.equal(bridgeAddress("not a url"), null);
  assert.equal(bridgeAddress(""), null);
  assert.equal(bridgeAddress(undefined), null);
});

test("the listening check sees a real listener and a closed port", async () => {
  const server = net.createServer(() => {});
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  assert.equal(await probeBridgeListener({ host: "127.0.0.1", port, timeoutMs: 500 }), true);
  await new Promise((resolve) => server.close(resolve));
  assert.equal(await probeBridgeListener({ host: "127.0.0.1", port, timeoutMs: 500 }), false);
});
