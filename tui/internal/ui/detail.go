package ui

import (
	"strings"

	"github.com/milesibastos/quarterdeck/tui/internal/nomistakes"
)

// The detail block is where the list stops comparing and starts explaining.
//
// Every field the rows shortened is here at full length: the title upstream
// wrote, the fleet's own state word when the list drew a different one, the
// project even when the row had no room for it, whatever the worker last said
// it was doing, and - the reason this block exists - the whole sentence saying
// why Enter will not open this row. Three rows sharing one refusal print it
// once, here, instead of three times up there.
//
// It wraps and never elides. A reason cut in half is a reason an operator has
// to go and find somewhere else, which is the failure the block was built to
// end.
const labels = 8

func (m Model) detail() []string {
	if !m.loaded || m.loadErr != "" || len(m.items) == 0 {
		return nil
	}
	item := m.items[m.cursor]
	lines := []string{"selected " + m.place(m.cursor)}
	lines = append(lines, m.field("title", item.Title)...)
	lines = append(lines, m.field("state", selectedState(item))...)
	lines = append(lines, m.field("project", item.Project)...)
	if activity := activityOf(item); activity != "" {
		lines = append(lines, m.field("activity", activity)...)
	}
	lines = append(lines, m.field("run", runSentence(item))...)
	if !item.Attachable() && item.Attach.Why != "" {
		lines = append(lines, m.field("reason", item.Attach.Why)...)
	}
	return append(lines, "")
}

func (m Model) field(label, value string) []string {
	return hang(pad(label, labels), value, m.columns())
}

// selectedState keeps the fleet's own word beside the operational one whenever
// the mapping changed it.
//
// The list is allowed to say `waiting` where upstream said `paused`, because
// the list is for scanning. The detail block is what an operator checks the
// contract against, and a reading aid that erases the source term makes that
// impossible.
func selectedState(item Item) string {
	label := stateLabel(item.State)
	raw := item.State
	if raw == "" {
		raw = unknownState
	}
	if label == raw {
		return label
	}
	return label + " (fleet: " + raw + ")"
}

// activityOf is what the worker last said it was doing, and nothing when that
// only repeats the state column.
func activityOf(item Item) string {
	detail := strings.TrimSpace(item.Detail)
	if detail == "" {
		return ""
	}
	if strings.EqualFold(detail, item.State) || strings.EqualFold(detail, stateLabel(item.State)) {
		return ""
	}
	return detail
}

// runSentence says exactly what Enter does here, in the same short label the
// row drew plus the consequence the row had no room for.
func runSentence(item Item) string {
	if item.Attachable() {
		return nomistakes.Ready.Label() + " -- Enter opens no-mistakes run " +
			item.Attach.RunID + " in this worktree"
	}
	return runKind(item).Label() + " -- Enter unavailable"
}
