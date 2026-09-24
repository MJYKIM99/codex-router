- **`doctor` reports the ChatGPT Web bridge, and the provider's two accounts
  are documented as deliberately separate.** A selected `chatgpt-web` route is
  the one route whose upstream is another program rather than a provider the
  router starts, and the router relays its connection failure verbatim and
  never retries — by design, because a retry would spend a second browser turn.
  The first symptom of a stopped bridge was therefore a turn that failed. When
  `chatgpt-web` is one of the enabled providers, doctor now makes one loopback
  connect and reports **ChatGPT Web bridge**: `listening at <address>` at the
  address the route would actually use, including a
  `MODEL_ROUTER_CHATGPT_WEB_BASE_URL` override, or a warning naming
  `codex-chatgpt-web serve` and its `service install` when nothing answers. A
  listening check rather than an HTTP request, because the bridge serves
  `/v1/models` from the signed-in account and a refusal there would say nothing
  about whether the port is up. Providers other than `chatgpt-web` pay nothing:
  the probe does not run at all. The README now states what the probe implies —
  a web turn runs as the launcher's browser sign-in, not as the ChatGPT account
  Codex is using, with the router sending a placeholder bearer and dropping the
  account headers — so switching Codex accounts leaves web turns alone and
  leaves the curated rows in the account-independent `user-models.json`, which
  the switch's own catalog republication re-applies. Re-signing the launcher's
  browser needs `setup --refresh-account-capabilities`, and `serve` reads its
  configuration once, so changing the bridge's own configuration needs a
  restart.
