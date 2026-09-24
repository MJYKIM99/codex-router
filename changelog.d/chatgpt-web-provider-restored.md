- **The ChatGPT Web provider comes back, opt-in, with its account-ban risk
  stated instead of implied.** `chatgpt-web` routes Codex turns straight into
  the `codex-chatgpt-web` launcher's loopback bridge on 17841 instead of
  through LiteLLM, so Codex's native tool, collaboration, image, and compaction
  envelope reaches the browser bridge unflattened while the caller's ChatGPT
  bearer is replaced by a non-secret local placeholder. This reverses a
  removal: the provider was deleted for exactly the reason it now documents
  — driving a ChatGPT account through browser automation is outside OpenAI's
  terms of service, and a ban lands on the signed-in account — so the warning
  moved into the README rather than staying an argument for absence. Nothing
  activates by itself: the provider is `explicitSelection`, Codex-only, and
  unpublished from DeepSeek Harness and Gemini CLI, so a turn reaches it only
  after `providers enable chatgpt-web` and `curate-models chatgpt-web`. Browser
  turns are never retried, never failed over, and never recruited as another
  model's vision helper, because each of those would spend a second browser
  turn; `test/routing.test.mjs` proves those boundaries end to end against the
  current router. Anyone who curated `chatgpt-web/*` rows before the removal
  gets them back on their next load; anyone who never used it is unaffected.
