- **ChatGPT Web curation no longer asks the bridge for a catalog it structurally
  cannot read.** `codex-chatgpt-web` 6.0.0 merges the caller's own ChatGPT rows
  into `/v1/models` through a native passthrough, so reading that endpoint needs
  the caller's ChatGPT bearer — the one credential this router deliberately
  never hands to a same-user process. Measured against the shipped bridge, an
  unauthenticated read returns `Native Codex passthrough requires the incoming
  Bearer authorization` and a placeholder bearer is rejected by the upstream
  with `Could not parse your authentication token`, so every curation run ended
  in `Provider model discovery returned HTTP 401` and the provider could not be
  given any models at all. Curation for a direct Responses provider now builds
  its catalog from the checked-in route table — the same table that documents
  each route's effort ladder — and sizes each row from the window the bridge
  declares for itself in its own configuration, so `curate-models chatgpt-web`
  works without reading any endpoint. `--fixture` keeps the ordinary discovery
  path, which preserves the catalog-injection contract and its test. Account
  gating is unchanged and still enforced by the bridge: a route the signed-in
  account does not expose fails on its own turn with the bridge's own message
  rather than being hidden here, because nothing on this side can read that
  account's capability list without the credential above.
