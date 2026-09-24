- **`doctor` now reports the second program that wants Codex's route.** The
  router and `codex-chatgpt-web` both write `openai_base_url`, and the launcher
  writes whichever `config.toml` its journal names, so its next repair or
  upgrade could take the route with nothing in the router's own state saying
  so. A new **ChatGPT Web launcher** check reads that journal — without
  launching the launcher or reading its credential — and sorts the situations
  that matter into healthy and not:

  Healthy is no launcher at all, a launcher that is installed but has never
  installed its Codex integration, an inactive one, and one active for a
  different profile. That second state is worth its own wording: a launcher used
  purely as a browser sidecar is installed and working, and reporting it as
  "not installed" told an operator with that exact setup that the program was
  missing.

  A warning covers an integration that still targets the profile the router
  serves (its next repair or upgrade re-asserts that route), one that names no
  profile, and one that cannot be read. A journal whose baseline cannot be read
  reports the warning rather than claiming a takeover it has not proved, and so
  does one that names no profile, since "aimed somewhere else" is the answer
  that keeps the router quiet and must never be guessed.

  A failure is its recorded route being the one live in the file: Codex is
  bypassing the router now, and `doctor --fix` cannot repair it because it
  refuses to overwrite an `openai_base_url` it does not own.

  Two profile paths are compared after `~` expansion and resolution, and two
  route spellings after trailing-slash and loopback-host normalization, because
  a mismatch in either comparison is the direction that stays silent. A journal
  that is not a regular file is reported rather than read, so a FIFO cannot hang
  the run. The README section for the provider now states the one rule that
  keeps the two apart: run the launcher's `setup`, `repair`, or `upgrade` with
  `CODEX_HOME=$HOME/.codex-cgw` so its buttons write a profile the router does
  not serve.
