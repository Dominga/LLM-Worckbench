# Registry format

The Workbench can subscribe to one or more **registries** — JSON
endpoints listing installable **modes** and **families**. The default
subscription is the curated repo at
[`Dominga/llm-workbench-registry`](https://github.com/Dominga/llm-workbench-registry);
users can add private or community mirrors via Settings → Registry →
Add source.

This document is the schema reference for anyone authoring a mode/
family or hosting their own registry.

## `index.json`

Every source serves one JSON file at its registered URL. The schema:

```json
{
  "schema_version": 1,
  "updated_at": "2026-05-13T12:34:56Z",
  "artifacts": [
    {
      "type": "mode" | "family",
      "id": "worldbuilder",
      "version": "1.2.0",
      "sha256": "<hex of file contents concatenated in declared order>",
      "files": [
        { "path": "worldbuilder.toml", "url": "https://..." },
        { "path": "worldbuilder.system.md", "url": "https://..." }
      ],
      "description": "...",
      "tags": ["narrative", "rpg"],
      "recommended_for": ["qwen3"],
      "author": "...",
      "preview": "First ~500 chars of the system prompt"
    }
  ]
}
```

Key rules:

- `type` decides the install destination. `mode` files land in
  `~/.config/llm-workbench/modes/`; `family` files land in
  `~/.config/llm-workbench/families/`. Both pick up the bundled-seed
  resolver chain after install (see [`prompt-variables.md`](prompt-variables.md)
  for mode template precedence).
- `id` must match `[a-z0-9][a-z0-9._-]{0,63}` — the Workbench uses it
  as the destination filename basename.
- `files[].path` must be a basename, not a path. Installs reject
  anything with slashes as a safety measure.
- `sha256` is optional but strongly recommended. The Workbench
  computes SHA-256 over each file's content in `files[]` order and
  refuses to install on mismatch.
- `version` is free-form; semver is recommended so the
  "update available" badge logic can compare cleanly.
- `recommended_for` is advisory — the mode picker shows a small
  warning when the active chat profile's family isn't in the list.
- `preview` shows in the Settings → Registry browser before install.
  Up to ~500 chars; longer strings are truncated upstream.

## App-side behaviour

- **Subscribed sources** live in
  `~/.config/llm-workbench/registry/sources.toml`. Each entry has an
  ID (slug of the human name), the URL, and an `auto_refresh` flag
  (reserved for TD33 follow-up).
- **Cached indexes** sit under `registry/cache/<sourceID>/index.json`.
  `BrowseRegistry` reads only the cache — refresh is an explicit
  `RefreshRegistrySource` (or `RefreshAllRegistrySources`) call.
- **Installed ledger** at `registry/installed.toml` records every
  artifact: source, version, files written, install timestamp. The
  uninstall path uses this to clean files; the browser uses it to
  flag "installed" + "update available".

## Hosting your own registry

The Workbench doesn't care where `index.json` is served from as long
as plain HTTP/HTTPS GET works. The curated repo's
`scripts/build_index.py` (Python 3.11+, optional `tomli` for older
versions) is a reference implementation — it scans `modes/<id>/`
and `families/<id>/` directories and emits the schema above.

Easy hosting paths:

- **GitHub raw**: commit `index.json` into the main branch of a
  public repo. Subscribers use
  `https://raw.githubusercontent.com/<owner>/<repo>/main/index.json`.
- **GitHub Pages**: publish `index.json` from the `gh-pages` branch.
- **Anywhere with HTTPS**: serve a static file; set
  `Content-Type: application/json` and you're done.

Signing isn't supported in v1 — the SHA-256 in the index is the only
integrity check. Don't subscribe to sources you wouldn't trust to
edit your `~/.config/llm-workbench/modes/` directory.
