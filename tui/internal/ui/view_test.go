package ui

import (
	"context"
	"errors"
	"strconv"
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
	emptyListing  = "current_branch: fm/demo-almanac-a1\nruns_on_current_branch: 0\n"
	setupRefusal  = "error: repo not initialized (run 'no-mistakes init' first)\n"
	fixtureGen    = "2099-01-01T09:00:00Z"
	almanacWorktr = "/opt/worktrees/demo-almanac-a1"
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
				if dir == almanacWorktr {
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

// The approved layout at the width it was approved at.
func TestTheWideTableAtTheApprovedWidth(t *testing.T) {
	view := four(t, 120, 3).View()

	head := lineWith(t, view, stateHead)
	for _, want := range []string{numberHead, stateHead, runHead, projectHead, workHead} {
		if !strings.Contains(head, want) {
			t.Errorf("the heading row has no %q column: %q", want, head)
		}
	}

	// Every column starts under its own heading on every row, which is the
	// whole point of the table: an operator compares down a column.
	for _, column := range []string{stateHead, runHead, projectHead} {
		at := strings.Index(head, column)
		for i, row := range rowLines(t, view) {
			if at >= len(row) || row[at] == ' ' {
				t.Errorf("row %d has nothing under %s:\n%s", i+1, column, view)
			}
		}
	}

	header := lines(view)[0]
	if !strings.HasPrefix(header, "quarterdeck / woot  4 active") || !strings.HasSuffix(header, "snapshot 8s old") {
		t.Errorf("header = %q", header)
	}
	if counts := lines(view)[1]; counts != "2 working | 2 waiting"+strings.Repeat(" ",
		120-len("2 working | 2 waiting")-len("run access: 0 ready | 1 no run | 3 repo setup"))+
		"run access: 0 ready | 1 no run | 3 repo setup" {
		t.Errorf("counts = %q", counts)
	}
	if !strings.Contains(view, keys) {
		t.Errorf("the footer is not the approved one:\n%s", view)
	}
}

// rowLines is the four work-item lines of a wide table.
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

// The marker is a character in the first column and nothing else - no colour,
// no weight, nothing a terminal theme can take away.
func TestTheSimpleMarkerIsTheOnlySelection(t *testing.T) {
	for _, cursor := range []int{0, 1, 2, 3} {
		view := four(t, 120, cursor).View()
		var marked []string
		for _, row := range rowLines(t, view) {
			if strings.HasPrefix(row, cursorHere) {
				marked = append(marked, row)
			}
		}
		if len(marked) != 1 {
			t.Fatalf("cursor %d: %d rows marked, want 1:\n%s", cursor, len(marked), view)
		}
		if want := cursorHere + " " + strconv.Itoa(cursor+1); !strings.HasPrefix(marked[0], want) {
			t.Errorf("cursor %d marked %q", cursor, marked[0])
		}
		if !strings.Contains(view, "selected "+strconv.Itoa(cursor+1)+"/4") {
			t.Errorf("the detail block does not follow the cursor to %d:\n%s", cursor+1, view)
		}
	}
}

// The repetition the redesign was for: one refusal shared by three rows is
// printed once, beside the row it was asked about.
func TestOnlyTheSelectedRowCarriesTheRefusal(t *testing.T) {
	view := four(t, 120, 3).View()
	const refusal = "repo not initialized (run 'no-mistakes init' first)"
	if count := strings.Count(view, refusal); count != 1 {
		t.Errorf("the refusal appears %d times, want 1:\n%s", count, view)
	}
	lineWith(t, view, refusal)
	if !strings.Contains(lineWith(t, view, refusal), "reason") {
		t.Errorf("the one copy is not in the detail block:\n%s", view)
	}
	// Every row still says what kind of refusal it was.
	if count := strings.Count(view, nomistakes.RepoSetup.Label()); count < 4 {
		t.Errorf("the short label appears %d times, want one per row plus the detail:\n%s", count, view)
	}
}

// The selected block keeps every field the row shortened, at full length.
func TestTheSelectedDetailKeepsWhatTheRowsShortened(t *testing.T) {
	const width = 100
	view := four(t, width, 3).View()
	const title = "cluster almanac (k8s.example.test): read-only cluster diagnostic, focus on the beacon tenant services"

	if !strings.Contains(view, "selected 4/4") {
		t.Fatalf("no detail heading:\n%s", view)
	}
	// The title is too long for one line at this width, so it must be there in
	// two - wrapped, never elided.
	if strings.Contains(view, title) {
		t.Fatalf("the title fitted on one line; the wrapping is untested at this width")
	}
	if !strings.Contains(joined(view), title) {
		t.Errorf("the full title is not in the detail block:\n%s", view)
	}
	for _, want := range []string{
		"state   : waiting (fleet: paused)",
		"project : harbour",
		"activity: pull request 56 updated with the cleanup",
		"run     : repo setup -- Enter unavailable",
		"reason  : repo not initialized",
	} {
		if !strings.Contains(view, want) {
			t.Errorf("the detail block does not say %q:\n%s", want, view)
		}
	}
	for _, line := range lines(view) {
		if widthOf(line) > width {
			t.Errorf("a wrapped line is %d wide: %q", widthOf(line), line)
		}
		if strings.Contains(line, ellipsis) && strings.Contains(line, "reason") {
			t.Errorf("a reason was elided rather than wrapped: %q", line)
		}
	}
}

// joined puts the wrapped detail lines back together, so a test can look for
// the whole sentence without knowing where the wrap fell.
func joined(view string) string {
	var out []string
	for _, line := range lines(view) {
		out = append(out, strings.TrimSpace(line))
	}
	return strings.Join(out, " ")
}

// A ready row says exactly what Enter opens, which is the one thing the short
// label cannot carry.
func TestAReadyRowSaysWhatEnterOpens(t *testing.T) {
	source := newLoads([]app.Item{attachable})
	model := listed(t, source)
	sized, _ := model.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	view := sized.(Model).View()
	if !strings.Contains(view, "run     : ready -- Enter opens no-mistakes run 01AAAAAAAAAAAAAAAAAAAAAAAA in this worktree") {
		t.Errorf("a ready row does not say what Enter opens:\n%s", view)
	}
	if strings.Contains(view, "reason") {
		t.Errorf("a ready row printed a reason:\n%s", view)
	}
}
