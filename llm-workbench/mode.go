package main

// Session-mode metadata. Static registry for M1 — backend behaviour is
// added in M3 (system prompt, tool whitelist, context strategy per
// DESIGN.md §4.6). Frontend mirrors this list in shell/types.ts.
//
// Modes are referenced by ID from sessions, so renaming a label does not
// orphan existing chats.

type ModeSource string

const (
	ModeSourceBuiltin ModeSource = "builtin"
	ModeSourcePlugin  ModeSource = "plugin"
)

type Mode struct {
	ID     string     `json:"id"`
	Name   string     `json:"name"`
	Color  string     `json:"color"`
	Source ModeSource `json:"source"`
	Desc   string     `json:"desc"`
	Plugin string     `json:"plugin,omitempty"`
}

var builtinModes = []Mode{
	{
		ID:     "narrative-coauthor",
		Name:   "Narrative co-author",
		Color:  "#3b82f6",
		Source: ModeSourceBuiltin,
		Desc:   "Long-form prose. Edits stage as diffs, never silent rewrites.",
	},
	{
		ID:     "dialogue-writer",
		Name:   "Dialogue writer",
		Color:  "#a78bfa",
		Source: ModeSourceBuiltin,
		Desc:   "Voice-first. Stays in character; never narrates around the line.",
	},
	{
		ID:     "game-designer",
		Name:   "Game designer",
		Color:  "#f59e0b",
		Source: ModeSourceBuiltin,
		Desc:   "Numbers, tables, balance. Cites lore before suggesting changes.",
	},
	{
		ID:     "lore-keeper",
		Name:   "Lore keeper",
		Color:  "#22c55e",
		Source: ModeSourceBuiltin,
		Desc:   "Read-only by default. Cross-references and consistency sweeps.",
	},
}

func ListBuiltinModes() []Mode {
	out := make([]Mode, len(builtinModes))
	copy(out, builtinModes)
	return out
}

func ModeByID(id string) (Mode, bool) {
	for _, m := range builtinModes {
		if m.ID == id {
			return m, true
		}
	}
	return Mode{}, false
}
