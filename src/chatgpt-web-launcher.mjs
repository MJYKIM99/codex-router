import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

// A journal is a small JSON document. Anything larger is not the file this
// check understands, and reading it could cost the whole diagnostic run.
const MAX_JOURNAL_BYTES = 1 << 20;

// codex-chatgpt-web is a separate program with its own home (the Electron
// profile, the browser sign-in, and a journal recording which Codex profile it
// believes it owns). That home is deliberately independent of CODEX_HOME, so
// one launcher serves every Codex profile; only the journal's recorded target
// path decides which config.toml its setup/repair/upgrade buttons will write.
//
// The router owns one profile. When the launcher's journal targets that same
// file, the two programs disagree about who owns Codex routing, and the router
// only finds out when the launcher next acts. This module reads that claim
// without running the launcher, without its token, and without touching the
// file it names, so doctor can report the disagreement instead of waiting for
// it to surface as a broken route.
export function chatgptWebHome(environment = process.env) {
  const configured = typeof environment?.CODEX_CHATGPT_WEB_HOME === "string"
    ? environment.CODEX_CHATGPT_WEB_HOME.trim()
    : "";
  return canonicalProfilePath(configured || path.join(os.homedir(), ".codex-chatgpt-web"));
}

export function chatgptWebJournalPath(environment = process.env) {
  return path.join(chatgptWebHome(environment), "codex", "integration-journal.json");
}

export function chatgptWebConfigPath(environment = process.env) {
  return path.join(chatgptWebHome(environment), "config.json");
}

// Both programs compute the profile path separately, so either side can carry
// a `~`, a symlink, or a different case for the same file. A mismatch reads as
// "aimed somewhere else", which is the answer that lets the router stay quiet,
// so resolve as far as the filesystem allows before calling two paths
// different.
function canonicalProfilePath(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const expanded = text.startsWith("~/") || text.startsWith("~\\")
    ? path.join(os.homedir(), text.slice(2))
    : text;
  const resolved = path.resolve(expanded);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

export function sameCodexProfile(left, right) {
  const leftPath = canonicalProfilePath(left);
  const rightPath = canonicalProfilePath(right);
  if (!leftPath || !rightPath) return false;
  return process.platform === "win32"
    ? leftPath.toLowerCase() === rightPath.toLowerCase()
    : leftPath === rightPath;
}

// The bridge's own configuration is where the window it serves is declared, so
// curation can size a web route from the bridge instead of guessing. Read with
// the same regular-file and size bound as the journal: this is another
// program's document, and a diagnostic or a curation run must not hang on it.
export function readChatgptWebBridgeConfig({
  environment = process.env,
  configPath = chatgptWebConfigPath(environment),
} = {}) {
  let stats;
  try {
    stats = statSync(configPath);
  } catch {
    return undefined;
  }
  if (!stats.isFile() || stats.size > MAX_JOURNAL_BYTES) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const contextWindow = Number(parsed.contextWindow);
  const mode = typeof parsed.mode === "string" ? parsed.mode : undefined;
  return {
    mode,
    contextWindow: Number.isInteger(contextWindow) && contextWindow > 0 ? contextWindow : undefined,
    // Browser-only and full both carry images through the browser turn; nothing
    // else is advertised to Codex for these routes.
    carriesImages: mode === "browser-only" || mode === "full",
    configPath,
  };
}

// Route spellings differ by a trailing slash or by writing the loopback host
// two ways. Missing that match is the quiet failure: the launcher's route would
// look like "not the live one" while Codex is in fact reaching the launcher.
function comparableRouteUrl(value) {
  const text = String(value ?? "").trim();
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.replace(/^localhost$/i, "127.0.0.1");
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol.toLowerCase()}//${host}${parsed.port ? `:${parsed.port}` : ""}${pathname}`;
  } catch {
    return text.replace(/\/+$/, "");
  }
}

// Never throws. A journal the launcher wrote is untrusted input from another
// program, so a damaged one degrades to a reported state rather than an
// exception in the middle of a diagnostic run.
export function readChatgptWebRouteClaim({
  environment = process.env,
  configPath,
  journalPath = chatgptWebJournalPath(environment),
} = {}) {
  const home = chatgptWebHome(environment);
  let stats;
  try {
    stats = statSync(journalPath);
  } catch {
    // The launcher's own data directory is what says it is installed at all; a
    // launcher that never installed its Codex integration is a different state
    // from no launcher, and reporting the first as the second reads as "you do
    // not have this program" to someone who does.
    return { installed: false, damaged: false, journalPath, home, homePresent: existsSync(home) };
  }
  // Only a regular file is read: a FIFO would block the whole run and a device
  // node would never end.
  if (!stats.isFile() || stats.size > MAX_JOURNAL_BYTES) {
    return { installed: true, damaged: true, journalPath, home };
  }
  let journal;
  try {
    journal = JSON.parse(readFileSync(journalPath, "utf8"));
  } catch {
    return { installed: true, damaged: true, journalPath, home };
  }
  if (!journal || typeof journal !== "object" || Array.isArray(journal)) {
    return { installed: true, damaged: true, journalPath, home };
  }
  const installed = journal.installed;
  const route = installed && typeof installed === "object" ? installed : {};
  // Older journal versions are upgraded by the launcher's own Setup, so an
  // unrecognised shape reports what it has rather than guessing a baseline.
  const claimedBaseUrl = typeof route.openai_base_url === "string" && route.openai_base_url
    ? route.openai_base_url
    : null;
  const claimedConfigPath = typeof journal.configPath === "string" && journal.configPath
    ? journal.configPath
    : null;
  return {
    installed: true,
    damaged: false,
    home,
    journalPath,
    // A journal that does not say `false` has not said it will stay out of the
    // way, and an unrecognised shape is not evidence of inactivity.
    active: journal.active !== false,
    claimedConfigPath,
    claimedBaseUrl,
    ownsCodexProfile: Boolean(
      configPath && claimedConfigPath && sameCodexProfile(claimedConfigPath, configPath),
    ),
  };
}

// Classify the claim against the profile the router is actually serving.
// `taken-over` is asserted only on evidence -- the launcher's recorded base URL
// being the one live in the file -- so an unrecognised journal baseline reports
// `latent` rather than claiming a takeover it cannot prove.
export function chatgptWebOwnershipVerdict({ claim, codexBaseUrls = [] } = {}) {
  if (!claim?.installed) return { state: "absent" };
  if (claim.damaged) return { state: "unreadable" };
  // "Aimed somewhere else" is the answer that keeps the router quiet, so a
  // journal that records no target must not produce it: that is exactly the
  // state where nobody can say which profile the launcher will write.
  if (!claim.claimedConfigPath) return { state: "unverifiable" };
  if (!claim.ownsCodexProfile) {
    return { state: claim.active ? "other-profile" : "inactive" };
  }
  if (!claim.active) return { state: "disconnected" };
  const live = (Array.isArray(codexBaseUrls) ? codexBaseUrls : []).map(comparableRouteUrl);
  const claimed = claim.claimedBaseUrl === null ? null : comparableRouteUrl(claim.claimedBaseUrl);
  return {
    state: claimed !== null && live.includes(claimed) ? "taken-over" : "latent",
  };
}

export function bridgeAddress(baseUrl) {
  try {
    const url = new URL(String(baseUrl));
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    if (!url.hostname || !Number.isInteger(port) || port <= 0 || port > 65_535) return null;
    return { host: url.hostname, port };
  } catch {
    return null;
  }
}

// A listening check, not an HTTP request: the bridge serves /v1/models from the
// signed-in account's own catalog and may refuse an unauthenticated call, so a
// 401 there would say nothing about whether the port is up. What the router
// needs to know before it offers a web model is only whether a turn would have
// somewhere to go.
export function probeBridgeListener({ host, port, timeoutMs = 1_000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let socket = null;
    const finish = (listening) => {
      if (settled) return;
      settled = true;
      if (socket) socket.destroy();
      resolve(listening);
    };
    try {
      socket = net.connect({ host, port });
    } catch {
      resolve(false);
      return;
    }
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}
