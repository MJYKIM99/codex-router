// Compatibility contract reviewed against codex-chatgpt-web 6.1.0
// (293341084ac7) and 6.1.1 (a13cd0995096). Both releases have identical
// src/chatgpt-web-models.ts and src/model-catalog.ts. Its config is a saved
// account-capability snapshot, never proof of a current browser login.
const CHATGPT_WEB_RELEASES = new Set(["6.1.0", "6.1.1"]);

export function chatgptWebDiscovery(config, registered = []) {
  const modelMetadata = chatgptWebModels(config);
  const discovered = modelMetadata.map(model => model.upstreamId);
  const known = new Set(registered);
  const unregistered = discovered.filter(id => !known.has(id));
  return {
    provider: "chatgpt-web", discovered, registered, unregistered,
    addable: unregistered, blocked: {}, unavailable: registered.filter(id => !discovered.includes(id)),
    contextLengths: Object.fromEntries(modelMetadata.map(model => [model.upstreamId, model.contextWindow])),
    inputModalities: Object.fromEntries(modelMetadata.map(model => [model.upstreamId, model.inputModalities])),
    modelMetadata, cached: false, stale: false,
    note: `Verified ${config.releaseVersion} contract and saved launcher capabilities; browser sign-in and live entitlement are not probed.`,
  };
}

export function chatgptWebModels(config) {
  if (!CHATGPT_WEB_RELEASES.has(config?.releaseVersion) || config?.version !== 3) {
    throw new Error("ChatGPT Web curation requires a verified 6.1.0 or 6.1.1 configuration; existing routes are preserved. Review the bridge contract before upgrading.");
  }
  if (!["full", "browser-only"].includes(config.mode)
    || !["automatic", "manual"].includes(config.browserInteractionMode)
    || !["native", "compatibility-v1"].includes(config.subagentProtocol)
    || ["solAvailable", "proAvailable", "extraHighAvailable", "experimentalBiggerContext"]
      .some(key => typeof config[key] !== "boolean")) {
    throw new Error("ChatGPT Web capability configuration is incomplete; refresh it in the launcher before curating models.");
  }
  const models = [];
  const add = (id, displayName, efforts, defaultEffort, contextWindow, autoCompact, legacy = false) => {
    models.push({
      upstreamId: `chatgpt-web/${id}`, displayName, legacy,
      description: `ChatGPT Web ${config.releaseVersion}; saved launcher capabilities, browser sign-in not verified.`,
      reasoningLevels: efforts.map(effort => ({ effort, description: `${displayName} — ${effort}` })),
      defaultEffort, contextWindow, autoCompact,
      inputModalities: config.browserInteractionMode === "manual" ? ["text"] : ["text", "image"],
    });
  };
  if (config.browserInteractionMode === "manual") {
    if (config.experimentalBiggerContext || typeof config.zeroRiskProEnabled !== "boolean") {
      throw new Error("ChatGPT Web manual mode requires an explicit Pro setting and does not support Bigger Context.");
    }
    add("zero-risk", "ChatGPT Web — Manual", ["low"], "low", 123000, 96000);
    if (config.zeroRiskProEnabled) add("zero-risk-pro", "ChatGPT Web — Manual Pro", ["low"], "low", 336579, 285000);
    return models;
  }
  if (!config.solAvailable) {
    add("gpt-5.6-luna", "GPT-5.6 Luna (Web)", ["low", "medium"], "low", 1050000, 1050000);
    add("luna", "ChatGPT Web — Luna", ["low"], "low", 1050000, 1050000, true);
    add("think", "ChatGPT Web — Think", ["low"], "low", 1050000, 1050000, true);
    return models;
  }
  const multiplier = config.experimentalBiggerContext ? 3 : 1;
  const addSol = (id, label, efforts, effort, legacy = false) => {
    const proMode = effort === "max" || effort === "ultra";
    const window = config.proAvailable ? (proMode ? 112193 : 111193) : effort === "low" ? 41000 : 90000;
    const compact = config.proAvailable ? 95000 : effort === "low" ? 32000 : 80000;
    add(id, label, efforts, effort, window * multiplier, compact * multiplier, legacy);
  };
  addSol("gpt-5.6-sol-instant", "GPT-5.6 Sol Instant (Web)", ["low"], "low");
  addSol("gpt-5.6-sol", "GPT-5.6 Sol (Web)", config.extraHighAvailable ? ["medium", "high", "xhigh"] : ["medium", "high"], "high");
  if (config.proAvailable) {
    addSol("gpt-5.6-pro", "GPT-5.6 Pro (Web)", ["max"], "max");
    addSol("gpt-6-pro", "GPT-6 Pro (Web)", ["max"], "max");
  }
  for (const [id, name, effort, enabled] of [
    ["light", "Instant", "low", true], ["medium", "Medium", "medium", true],
    ["high", "High", "high", true], ["extra-high", "Extra High", "xhigh", config.extraHighAvailable],
    ["pro", "Pro", "ultra", config.proAvailable],
  ]) {
    if (enabled) addSol(id, `ChatGPT Web — ${name}`, [effort], effort, true);
  }
  return models;
}
