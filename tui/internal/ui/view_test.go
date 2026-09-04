package ui

import (
	"strconv"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/milesibastos/quarterdeck/tui/internal/app"
	"github.com/milesibastos/quarterdeck/tui/internal/nomistakes"
)

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
	if !strings.Contains(view, keys) {
		t.Errorf("the footer is not the approved one:\n%s", view)
	}
}

// The header answers the two questions a list of four cannot: what the fleet
// is doing as a whole, and how much of it Enter can reach.
func TestTheWideHeader(t *testing.T) {
	view := four(t, 120, 3).View()
	first, second := lines(view)[0], lines(view)[1]

	if !strings.HasPrefix(first, "quarterdeck / woot  4 active") {
		t.Errorf("header = %q", first)
	}
	if !strings.HasSuffix(first, "snapshot 8s old") {
		t.Errorf("header does not date the picture: %q", first)
	}
	if !strings.HasPrefix(second, "2 working | 2 waiting") {
		t.Errorf("state counts = %q", second)
	}
	if !strings.HasSuffix(second, "run access: 0 ready | 1 no run | 3 repo setup") {
		t.Errorf("run counts = %q", second)
	}
	for _, line := range []string{first, second} {
		if widthOf(line) != 120 {
			t.Errorf("a header line is %d wide, so its halves are not at the ends: %q",
				widthOf(line), line)
		}
	}
}

// The marker is a character in the first column and nothing else - no colour,
// no weight, nothing a terminal theme can take away.
func TestTheSimpleMarkerIsTheOnlySelection(t *testing.T) {
	for _, cursor := range []int{0, 1, 2, 3} {
		view := four(t, 120, cursor).View()
		marked := markedRows(rowLines(t, view))
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

func markedRows(rows []string) []string {
	var marked []string
	for _, row := range rows {
		if strings.HasPrefix(row, cursorHere) {
			marked = append(marked, row)
		}
	}
	return marked
}

// The repetition the redesign was for: one refusal shared by three rows is
// printed once, beside the row it was asked about.
func TestOnlyTheSelectedRowCarriesTheRefusal(t *testing.T) {
	view := four(t, 120, 3).View()
	const refusal = "repo not initialized (run 'no-mistakes init' first)"

	if count := strings.Count(view, refusal); count != 1 {
		t.Errorf("the refusal appears %d times, want 1:\n%s", count, view)
	}
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
	const title = "cluster almanac (k8s.example.test): read-only cluster diagnostic, focus on the beacon tenant services"
	view := four(t, width, 3).View()

	// The title is too long for one line at this width, so it must be there in
	// two - wrapped, never elided.
	if strings.Contains(view, title) {
		t.Fatalf("the title fitted on one line; the wrapping is untested at this width")
	}
	if !strings.Contains(joined(view), title) {
		t.Errorf("the full title is not in the detail block:\n%s", view)
	}
	for _, want := range []string{
		"selected 4/4",
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
	assertDetailWrapsWithin(t, view, width)
}

// The detail block's own guarantee: inside the width, and never elided.
func assertDetailWrapsWithin(t *testing.T, view string, width int) {
	t.Helper()
	for _, line := range detailLines(view) {
		if widthOf(line) > width {
			t.Errorf("a wrapped line is %d wide: %q", widthOf(line), line)
		}
		if strings.Contains(line, ellipsis) {
			t.Errorf("the detail block elided rather than wrapped: %q", line)
		}
	}
}

// A ready row says exactly what Enter opens, which is the one thing the short
// label cannot carry.
func TestAReadyRowSaysWhatEnterOpens(t *testing.T) {
	source := newLoads([]app.Item{attachable})
	sized, _ := listed(t, source).Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	view := sized.(Model).View()

	if !strings.Contains(view, "run     : ready -- Enter opens no-mistakes run 01AAAAAAAAAAAAAAAAAAAAAAAA in this worktree") {
		t.Errorf("a ready row does not say what Enter opens:\n%s", view)
	}
	if strings.Contains(view, "reason") {
		t.Errorf("a ready row printed a reason:\n%s", view)
	}
}
