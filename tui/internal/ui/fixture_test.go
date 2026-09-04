package ui

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/milesibastos/quarterdeck/tui/internal/app"
	"github.com/milesibastos/quarterdeck/tui/internal/fleet"
	"github.com/milesibastos/quarterdeck/tui/internal/nomistakes"
)

// The four-row fixture is driven through the whole chain - snapshot, rows,
// `axi status`, the attach decision - rather than assembled as values here, so
// that what the layout is tested against is what a fleet actually produces.
//
// One worktree gets a listing with no run on its branch and the other three
// get the refusal a repository nobody initialised answers with. That is the
// captain's own mix: one `no run` against three sharing one sentence, which is
// the repetition this redesign exists to stop printing four times.
const (
	emptyListing   = "current_branch: fm/demo-almanac-a1\nruns_on_current_branch: 0\n"
	setupRefusal   = "error: repo not initialized (run 'no-mistakes init' first)\n"
	fixtureGen     = "2099-01-01T09:00:00Z"
	almanacWorktre = "/opt/worktrees/demo-almanac-a1"
	almanacProject = "almanac-app"
)

func fixtureLoader() app.Loader {
	return app.Loader{
		Source: fleet.SourceFor(fleet.Config{
			FixtureFile: "testdata/four-active.json",
			Label:       "testdata",
		}),
		DirExists: func(string) bool { return true },
		Resolver: nomistakes.Resolver{
			LookPath: func(string) (string, error) { return "/somewhere/no-mistakes", nil },
			Run: func(_ context.Context, dir string, _ ...string) (string, error) {
				if dir == almanacWorktre {
					return emptyListing, nil
				}
				return setupRefusal, errors.New("exit status 1")
			},
		},
	}
}

// four is the fixture drawn at one width, with the clock held eight seconds
// past the snapshot so the header's age is the same on every machine.
func four(t *testing.T, width, cursor int) Model {
	t.Helper()
	refresh, err := fixtureLoader().Load(context.Background())
	if err != nil {
		t.Fatalf("loading the fixture: %v", err)
	}
	if len(refresh.Items) != 4 {
		t.Fatalf("fixture rows = %d, want 4", len(refresh.Items))
	}
	generated, err := time.Parse(time.RFC3339, fixtureGen)
	if err != nil {
		t.Fatalf("fixture timestamp: %v", err)
	}
	model := New(fixtureLoader().Load, "woot")
	model.now = func() time.Time { return generated.Add(8 * time.Second) }
	next, _ := model.Update(itemsMsg{fleet: refresh})
	sized, _ := next.(Model).Update(tea.WindowSizeMsg{Width: width, Height: 40})
	shown := sized.(Model)
	for i := 0; i < cursor; i++ {
		shown = shown.move(1)
	}
	return shown
}

func lines(view string) []string { return strings.Split(strings.TrimRight(view, "\n"), "\n") }

// joined puts the wrapped lines back together, so a test can look for a whole
// sentence without knowing where the wrap fell.
func joined(view string) string {
	var out []string
	for _, line := range lines(view) {
		out = append(out, strings.TrimSpace(line))
	}
	return strings.Join(out, " ")
}

// lineWith is the one line holding text, and a failure when there is not
// exactly one.
func lineWith(t *testing.T, view, text string) string {
	t.Helper()
	var found []string
	for _, line := range lines(view) {
		if strings.Contains(line, text) {
			found = append(found, line)
		}
	}
	if len(found) != 1 {
		t.Fatalf("%d lines contain %q, want 1:\n%s", len(found), text, view)
	}
	return found[0]
}

// rowLines is the work-item lines of a wide table, which sit between the
// column headings and the blank line under them.
func rowLines(t *testing.T, view string) []string {
	t.Helper()
	var rows []string
	seen := false
	for _, line := range lines(view) {
		switch {
		case strings.Contains(line, stateHead):
			seen = true
		case seen && strings.TrimSpace(line) == "":
			return rows
		case seen:
			rows = append(rows, line)
		}
	}
	return rows
}

// narrowRowLines is the same for a narrow panel, which has no headings: every
// line between the header and the detail block.
func narrowRowLines(view string) []string {
	var rows []string
	for _, line := range lines(view) {
		switch {
		case strings.TrimSpace(line) == "":
			if len(rows) > 0 {
				return rows
			}
		case headerLine(line):
		default:
			rows = append(rows, line)
		}
	}
	return rows
}

func headerLine(line string) bool {
	return strings.HasPrefix(line, "quarterdeck") ||
		strings.Contains(line, "run access:") ||
		strings.Contains(line, " active")
}

// detailLines is everything from the selected heading to the footer.
func detailLines(view string) []string {
	var block []string
	seen := false
	for _, line := range lines(view) {
		switch {
		case strings.HasPrefix(line, "selected "):
			seen = true
		case seen && strings.TrimSpace(line) == "":
			return block
		case seen:
			block = append(block, line)
		}
	}
	return block
}
