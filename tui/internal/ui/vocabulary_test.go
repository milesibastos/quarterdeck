package ui

import (
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/milesibastos/quarterdeck/tui/internal/app"
)

// The list draws an operational word; the detail block keeps the fleet's own
// when the two differ. Both halves matter: the first is what makes a column
// scannable, the second is what keeps it checkable against the contract.
func TestTheStateVocabulary(t *testing.T) {
	cases := []struct {
		raw    string
		label  string
		detail string
	}{
		{"dispatched", "starting", "starting (fleet: dispatched)"},
		{"working", "working", "working"},
		{"validating", "checking", "checking (fleet: validating)"},
		{"pr_open", "PR open", "PR open (fleet: pr_open)"},
		{"in_review", "in review", "in review (fleet: in_review)"},
		{"parked", "needs you", "needs you (fleet: parked)"},
		{"blocked", "blocked", "blocked"},
		{"paused", "waiting", "waiting (fleet: paused)"},
		{"waiting_external", "waiting", "waiting (fleet: waiting_external)"},
		{"", "unknown", "unknown"},
		{"unknown", "unknown", "unknown"},
		{"a-state-from-a-later-upstream", "unknown", "unknown (fleet: a-state-from-a-later-upstream)"},
	}
	for _, want := range cases {
		if got := stateLabel(want.raw); got != want.label {
			t.Errorf("%q reads as %q, want %q", want.raw, got, want.label)
		}
		row := item("demo-alpha-a1", "", "no no-mistakes run on fm/demo-alpha-a1")
		row.State = want.raw
		if got := selectedState(row); got != want.detail {
			t.Errorf("%q in the detail block = %q, want %q", want.raw, got, want.detail)
		}
	}
}

// The header counts what the fleet is doing and what Enter can reach, and a
// state this build has never heard of is counted rather than dropped.
func TestTheHeaderCounts(t *testing.T) {
	rows := []app.Item{
		stateRow("demo-a", "working"),
		stateRow("demo-b", "paused"),
		stateRow("demo-c", "waiting_external"),
		stateRow("demo-d", "a-state-from-a-later-upstream"),
	}
	source := newLoads(rows)
	model := listed(t, source)
	sized, _ := model.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	shown := sized.(Model)
	if got := shown.stateCounts(); got != "1 working | 2 waiting | 1 unknown" {
		t.Errorf("state counts = %q", got)
	}
	if got := shown.runCounts(); got != "0 ready | 4 no run" {
		t.Errorf("run counts = %q", got)
	}
}

func stateRow(id, state string) app.Item {
	row := item(id, "", "no no-mistakes run on fm/"+id)
	row.State = state
	return row
}

// The age comes from the snapshot's own instant, carried through the loader
// rather than measured from the moment this program happened to read it.
func TestTheSnapshotAgeIsPlumbedThrough(t *testing.T) {
	generated := time.Date(2099, 1, 1, 9, 0, 0, 0, time.UTC)
	source := newLoads([]app.Item{attachable})
	source.generated = generated
	model := listed(t, source)

	for _, want := range []struct {
		at    time.Duration
		reads string
	}{
		{8 * time.Second, "snapshot 8s old"},
		{4 * time.Minute, "snapshot 4m old"},
		{3 * time.Hour, "snapshot 3h old"},
		{50 * time.Hour, "snapshot 2d old"},
		// A snapshot dated ahead of this clock reads as new, not as a negative
		// age: the fixtures are dated in 2099 so they never look stale.
		{-time.Hour, "snapshot 0s old"},
	} {
		model.now = func() time.Time { return generated.Add(want.at) }
		sized, _ := model.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
		if view := sized.(Model).View(); !strings.Contains(view, want.reads) {
			t.Errorf("at %s the header does not say %q:\n%s", want.at, want.reads, view)
		}
	}
}

// A snapshot carrying no readable instant says so rather than being dated from
// the read that fetched it.
func TestAnUnreadableSnapshotAgeSaysUnknown(t *testing.T) {
	source := newLoads([]app.Item{attachable})
	model := listed(t, source)
	sized, _ := model.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	view := sized.(Model).View()
	if !strings.Contains(view, "snapshot "+unknownAge) {
		t.Errorf("a snapshot with no instant invented one:\n%s", view)
	}
}

// An activity line that only repeats the state column earns no room.
func TestActivityIsDroppedWhenItRepeatsTheState(t *testing.T) {
	row := item("demo-alpha-a1", "01AAAAAAAAAAAAAAAAAAAAAAAA", "")
	row.State, row.Detail = "working", "working"
	source := newLoads([]app.Item{row})
	model := listed(t, source)
	sized, _ := model.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	if strings.Contains(sized.(Model).View(), "activity") {
		t.Errorf("the detail block repeated the state as activity:\n%s", sized.(Model).View())
	}

	row.Detail = "harness busy"
	source = newLoads([]app.Item{row})
	sized, _ = listed(t, source).Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	if !strings.Contains(sized.(Model).View(), "activity: harness busy") {
		t.Errorf("a real activity was dropped:\n%s", sized.(Model).View())
	}
}
