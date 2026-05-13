# Prompt template variables

Mode `system_prompt_template` files (`<id>.system.md`) and inline
`system_prompt` strings are rendered through a small placeholder
substitution pass before they reach the model. Substitutions use the
`{{key}}` syntax. Unknown keys are left as literal `{{foo}}` so typos
stay visible in the rendered prompt rather than silently dropping out.

## Available variables

### `project.*`

| Variable         | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| `project.id`     | Internal project UUID (`projectID` in the API).              |
| `project.name`   | Display name from `project.toml` (the form users edit).      |
| `project.path`   | Absolute filesystem path of the project root.                |

When the chat is project-unbound (TD22 "blank chat" start), all three
values are empty strings. Templates that hard-require a project should
detect this and degrade gracefully.

### `param.<name>`

User-supplied per-session inputs declared by the mode's `params` block.
A mode like:

```toml
[[params]]
name = "topic"
type = "string"
required = true
description = "what to dig into"
```

is rendered against a session whose `params.topic` value is substituted
into the template as `{{param.topic}}`. The new-session modal renders
a small form from this schema and the captured values ride with the
session for the lifetime of the conversation.

Types other than `string` (`int`, `number`, `bool`) are formatted with
Go's default `%v` formatter.

### `memory.global` and `memory.project`

The contents of the two `memory.md` files, injected verbatim:

* `memory.global` → `~/.config/llm-workbench/memory.md` (or
  `$XDG_CONFIG_HOME/llm-workbench/memory.md`). Per-user; shared across
  every project.
* `memory.project` → `<projectRoot>/.llm-workshop/memory.md`. Per
  project. Empty when the chat has no active project.

Missing files render as empty strings so the surrounding template
prose stays valid. Bundled prompts wrap each placeholder in a `#
Memory (<scope>)` section so an empty memory still looks intentional
rather than dropping a stray header.

The agent's `read_memory` / `append_memory` tools target these same
files, so notes the model leaves on one turn are visible to the
template on the next.

## Family-specific template variants

A mode's `system_prompt_template` is a basename like `agent.system.md`. When
the active chat profile carries a family tag, the loader looks for
family-tuned variants of that file before falling back to the default:

1. `<modeID>.<family>.<familyVersion>.system.md` — e.g.
   `agent.qwen3.3.5.system.md`. Tried only when the profile has both fields.
2. `<modeID>.<family>.system.md` — e.g. `agent.qwen3.system.md`.
3. `<modeID>.system.md` — the default, used when none of the above exist.

Each candidate is tried against the project-local modes dir first, then the
global modes dir. A project-default file still beats a global family-specific
variant (an explicit project override is a stronger user signal than a family
hint).

Authors who want to ship a Qwen3-specific tweak alongside the default just
drop `agent.qwen3.system.md` next to `agent.system.md` — no TOML changes.

## Mode `recommended_for` (advisory)

The mode TOML may declare a `recommended_for` list of family IDs the prompt
was tuned for:

```toml
recommended_for = ["qwen3", "qwen3.5"]
```

This is purely advisory — it never blocks a selection. The chat mode picker
just renders a small warning badge when the active profile's family isn't in
the list. Leaving the field empty (the default) means "no recommendation;
treat as family-agnostic".

## Example template

```markdown
You are an autonomous agent working in **{{project.name}}**
({{project.path}}).

Topic for this session: **{{param.topic}}**.

# Memory (global)
{{memory.global}}

# Memory (project)
{{memory.project}}
```

## Adding new variables

Both `project.*` and `memory.*` are seeded by
`ModeService.buildTemplateContext` (see `mode.go`). To add another
namespace:

1. Extend `buildTemplateContext` so the key shows up in the map.
2. Update this document.
3. If the source is project-scoped, guard against `projectID == ""`
   like the existing entries do.

`param.<name>` is wired separately: it just iterates the caller's
`params` map and prefixes each key with `param.`. No template-side
change is needed to support new params — declaring them on the mode
is enough.
