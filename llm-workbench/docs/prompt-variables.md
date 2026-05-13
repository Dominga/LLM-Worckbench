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
