package ui

import (
	"strconv"
	"strings"
	"testing"

	"github.com/milesibastos/quarterdeck/tui/internal/nomistakes"
)

// The threshold is a layout change and not a truncation: one column narrower
// and the same facts are drawn over two lines rather than squeezed out of one.
func TestTheLayoutThreshold(t *testing.T) {
	wide := four(t, wideColumns, 0).View()
	if len(rowLines(t, wide)) != 4 {
		t.Errorf("at %d columns the table is not one line per work item:\n%s", wideColumns, wide)
	}
	narrow := four(t, wideColumns-1, 0).View()
	if strings.Contains(narrow, stateHead) {
		t.Errorf("below the threshold the table still drew column headings:\n%s", narrow)
	}
	if got := len(narrowRowLines(narrow)); got != 8 {
		t.Errorf("below the threshold there are %d row lines, want two per work item:\n%s", got, narrow)
	}
}

// The regression this redesign is for: when width runs out, the title and the
// project give way before the selection, the state and what Enter will do.
func TestNarrowKeepsSelectionStateAndRunFirst(t *testing.T) {
	for _, width := range []int{88, 60, 48} {
		model := four(t, width, 3)
		view := model.View()
		assertWithin(t, view, width)
		assertRowsKeepTheEssentials(t, model, view)
		assertSelectedIsExplained(t, view)
	}
}

// assertWithin is the promise a narrow panel makes: no line runs off the side,
// so nothing wraps into what looks like another work item.
func assertWithin(t *testing.T, view string, width int) {
	t.Helper()
	for _, line := range lines(view) {
		if widthOf(line) > width {
			t.Errorf("at %d columns a line is %d wide: %q", width, widthOf(line), line)
		}
	}
}

// assertRowsKeepTheEssentials checks line one of every two-line row: where it
// sits, what the worker is doing, and what Enter will do.
func assertRowsKeepTheEssentials(t *testing.T, model Model, view string) {
	t.Helper()
	rows := narrowRowLines(view)
	marked := 0
	for i, item := range model.items {
		row := rows[i*2]
		for _, want := range []string{
			strconv.Itoa(i+1) + "/4",
			stateLabel(item.State),
			runKind(item).Label(),
		} {
			if !strings.Contains(row, want) {
				t.Errorf("row %q lost %q", row, want)
			}
		}
		if strings.HasPrefix(row, cursorHere) {
			marked++
		}
	}
	if marked != 1 {
		t.Errorf("%d rows are marked, want 1:\n%s", marked, view)
	}
}

// assertSelectedIsExplained is the other half of taking anything away from a
// row: whatever the list no longer says, the block under it still does.
func assertSelectedIsExplained(t *testing.T, view string) {
	t.Helper()
	if !strings.Contains(view, "selected 4/4") ||
		!strings.Contains(joined(view), "read-only cluster diagnostic") ||
		!strings.Contains(joined(view), "repo not initialized") {
		t.Errorf("the selected work item is not explained:\n%s", view)
	}
}

// The title preview is the first thing to give, and it gives ground long
// before any column does.
func TestTheTitlePreviewYieldsFirst(t *testing.T) {
	wide := narrowRowLines(four(t, 88, 3).View())
	tighter := narrowRowLines(four(t, 60, 3).View())

	if widthOf(tighter[1]) >= widthOf(wide[1]) {
		t.Errorf("the title preview did not yield first: %q against %q", tighter[1], wide[1])
	}
	if !strings.Contains(tighter[0], almanacProject) {
		t.Errorf("the project left before the title had finished yielding: %q", tighter[0])
	}
}

// Then the project, which is in the detail block either way.
func TestTheProjectYieldsBeforeTheRow(t *testing.T) {
	rows := narrowRowLines(four(t, 36, 3).View())
	if strings.Contains(rows[0], almanacProject) {
		t.Errorf("the project outlived the room for it: %q", rows[0])
	}
	if len(rows) != 8 {
		t.Errorf("the title preview left before the project: %d row lines", len(rows))
	}
	assertLineOneSurvives(t, rows)
}

// Then the alignment and the place in the list. What is left is what the row
// is for, and the detail block still carries every character.
func TestOnlyTheStateAndTheRunSurviveTheNarrowest(t *testing.T) {
	view := four(t, 20, 3).View()
	rows := narrowRowLines(view)

	if strings.Contains(rows[0], "1/4") {
		t.Errorf("the place survived a width that could not hold it: %q", rows[0])
	}
	assertLineOneSurvives(t, rows)

	// At twenty columns the wrapping has to break inside words, so what is
	// checked is that every character is still there and none was thrown away.
	squashed := strings.Join(strings.Fields(view), "")
	for _, want := range []string{
		"read-onlyclusterdiagnostic",
		"reponotinitialized(run'no-mistakesinit'first)",
	} {
		if !strings.Contains(squashed, want) {
			t.Errorf("at 20 columns the selected work item lost %q:\n%s", want, view)
		}
	}
	for _, line := range detailLines(view) {
		if strings.Contains(line, ellipsis) {
			t.Errorf("the detail block elided rather than wrapped: %q", line)
		}
	}
}

// assertLineOneSurvives is the floor: the selection, the state and what Enter
// will do, whatever else the width took.
func assertLineOneSurvives(t *testing.T, rows []string) {
	t.Helper()
	if !strings.HasPrefix(rows[0], cursorAway) || !strings.HasPrefix(rows[6], cursorHere) {
		t.Errorf("the selection is not on the fourth row: %q", rows[6])
	}
	if !strings.Contains(rows[0], "working") || !strings.Contains(rows[0], nomistakes.NoRun.Label()) {
		t.Errorf("the state or the run availability was lost: %q", rows[0])
	}
	if !strings.Contains(rows[2], nomistakes.RepoSetup.Label()) {
		t.Errorf("a refusal kind was lost: %q", rows[2])
	}
}
