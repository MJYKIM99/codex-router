- Preserve ChatGPT Web Responses events and opaque history without gateway
  rewrites, keep both compaction protocols on the browser bridge, and propagate
  cancellation without retrying browser turns. Pin curation to the verified
  6.1.0 account-capability contract, use per-model context/compaction budgets,
  and refresh retained model metadata without changing route identities.
  Doctor now verifies `/healthz` identity, readiness and version and reports
  stale capabilities. Document isolated profiles and preservation of local
  launcher patches during independent upgrades.
