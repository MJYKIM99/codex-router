// Run with Bun 1.4.0 and an unmodified v6.1.9 src/chatgpt-web-models.ts:
// bun generate-6.1.9.mjs /path/to/upstream/src/chatgpt-web-models.ts > 6.1.9.json
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const source = process.argv[2];
const upstream = await import(pathToFileURL(source).href);
const cases = [];
for (const browserInteractionMode of ["automatic", "manual"])
for (const solAvailable of [false, true])
for (const proAvailable of [false, true])
for (const extraHighAvailable of [false, true])
for (const setting of [false, true]) {
  const config = {
    version: 3, releaseVersion: "6.1.9", mode: "full", subagentProtocol: "compatibility-v1",
    browserInteractionMode, solAvailable, proAvailable, extraHighAvailable,
    experimentalBiggerContext: browserInteractionMode === "automatic" && setting,
    zeroRiskProEnabled: browserInteractionMode === "manual" && setting,
  };
  const models = upstream.availableChatGptWebModelRoutes(config, true).map(route => {
    const limits = upstream.resolveChatGptWebContextLimits(route.backendModel, route.adapterEffort, config, route.modelFamily);
    const efforts = upstream.chatGptWebRouteEfforts(route, config);
    if (route.supportedCodexEfforts) for (const effort of efforts) {
      assert.deepEqual(upstream.resolveChatGptWebContextLimits(route.backendModel, effort, config, route.modelFamily), limits);
    }
    return {
      id: route.slug, displayName: route.displayName, efforts, defaultEffort: route.codexEffort,
      contextWindow: limits.contextWindow, autoCompact: limits.autoCompactTokenLimit, legacy: route.legacy === true,
    };
  });
  cases.push({ config, models });
}
console.log(JSON.stringify({
  repository: "miuuyy/codex-chatgpt-web", revision: "c815a907a91af75f86a02218bd4ff3dc819a183f",
  source: "src/chatgpt-web-models.ts", sourceSha256: createHash("sha256").update(readFileSync(source)).digest("hex"), cases,
}, null, 2));
