package ui

import (
	"strconv"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/milesibastos/quarterdeck/tui/internal/app"
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

// narrowRowLines is everything between the header and the detail block.
func narrowRowLines(view string) []string {
	var rows []string
	for _, line := range lines(view) {
		if strings.TrimSpace(line) == "" {
			if len(rows) > 0 {
				return rows
			}
			continue
		}
		if strings.HasPrefix(line, "quarterdeck") || strings.Contains(line, "run access:") ||
			strings.Contains(line, " active") {
			continue
		}
		rows = append(rows, line)
	}
	return rows
}

// The regression this redesign is for: when width runs out, the title and the
// project give way before the selection, the state and what Enter will do.
func TestNarrowKeepsSelectionStateAndRunFirst(t *testing.T) {
	for _, width := range []int{88, 60, 48} {
		model := four(t, width, 3)
		view := model.View()
		for _, line := range lines(view) {
			if widthOf(line) > width {
				t.Errorf("at %d columns a line is %d wide: %q", width, widthOf(line), line)
			}
		}

		rows := narrowRowLines(view)
		marked := 0
		for i := 0; i < len(rows); i += 2 {
			row := rows[i]
			place := strconv.Itoa(i/2+1) + "/4"
			if !strings.Contains(row, place) {
				t.Errorf("at %d columns row %q does not say where it sits", width, row)
			}
			for _, want := range []string{stateLabel(model.items[i/2].State), runKind(model.items[i/2]).Label()} {
				if !strings.Contains(row, want) {
					t.Errorf("at %d columns row %q lost %q", width, row, want)
				}
			}
			if strings.HasPrefix(row, cursorHere) {
				marked++
			}
		}
		if marked != 1 {
			t.Errorf("at %d columns %d rows are marked, want 1:\n%s", width, marked, view)
		}
		// The selected work item is still explained in full, which is what
		// makes a narrow panel useful rather than merely legible.
		if !strings.Contains(view, "selected 4/4") ||
			!strings.Contains(joined(view), "read-only cluster diagnostic") ||
			!strings.Contains(joined(view), "repo not initialized") {
			t.Errorf("at %d columns the selected work item is not explained:\n%s", width, view)
		}
	}
}

// The yield order, demonstrated by taking the width away.
//
// Line one is the marker, the place in the list, the state and what Enter will
// do; the project is appended only while it fits, the column padding and then
// the place go after it, and the state and the run label go never. The title
// preview shortens all the way down rather than being the thing that decides
// the row's shape.
func TestNarrowShedsFieldsInPriorityOrder(t *testing.T) {
	// The title preview is the first thing to give, and it gives ground long
	// before any column does.
	wide := narrowRowLines(four(t, 88, 3).View())
	tighter := narrowRowLines(four(t, 60, 3).View())
	if widthOf(tighter[1]) >= widthOf(wide[1]) {
		t.Errorf("the title preview did not yield first: %q against %q", tighter[1], wide[1])
	}
	if !strings.Contains(tighter[0], "almanac-app") {
		t.Errorf("the project left before the title had finished yielding: %q", tighter[0])
	}

	// Then the project, which is in the detail block either way.
	dropped := narrowRowLines(four(t, 36, 3).View())
	if strings.Contains(dropped[0], "almanac-app") {
		t.Errorf("the project outlived the room for it: %q", dropped[0])
	}
	if len(dropped) != 8 {
		t.Errorf("the title preview left before the project: %d row lines", len(dropped))
	}

	// Then the alignment and the place in the list. What is left is what the
	// row is for.
	bare := narrowRowLines(four(t, 20, 3).View())
	if strings.Contains(bare[0], "1/4") {
		t.Errorf("the place survived a width that could not hold it: %q", bare[0])
	}
	for width, rows := range map[int][]string{36: dropped, 20: bare} {
		if !strings.HasPrefix(rows[0], cursorAway) || !strings.HasPrefix(rows[6], cursorHere) {
			t.Errorf("at %d columns the selection is not on the fourth row: %q", width, rows[6])
		}
		if !strings.Contains(rows[0], "working") || !strings.Contains(rows[0], nomistakes.NoRun.Label()) {
			t.Errorf("at %d columns the state or the run availability was lost: %q", width, rows[0])
		}
		if !strings.Contains(rows[2], nomistakes.RepoSetup.Label()) {
			t.Errorf("at %d columns a refusal kind was lost: %q", width, rows[2])
		}
	}

	// And the selected work item is still explained whole, which is the point
	// of taking anything away from the rows at all. At twenty columns the
	// wrapping has to break inside words, so what is checked is that every
	// character is still there and none of it was thrown away.
	view := four(t, 20, 3).View()
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

// A panel too narrow for the whole footer says the same four keys shorter
// rather than losing one off the end.
func TestTheFooterShrinksWithoutLosingAKey(t *testing.T) {
	view := four(t, 24, 0).View()
	if !strings.Contains(view, narrowKeys) {
		t.Errorf("no keys at 24 columns:\n%s", view)
	}
	for _, key := range []string{"j/k", "enter", "r", "q"} {
		if !strings.Contains(narrowKeys, key) {
			t.Errorf("the short footer dropped %q", key)
		}
	}
}

// Elision is a fixed rule, not a summary: the same title always shortens to
// the same string, and it keeps both ends because the tail is what tells two
// similar incidents apart.
func TestElisionIsDeterministicAndKeepsBothEnds(t *testing.T) {
	const title = "node-agent-hsh: btrfs /@/var mounted read-only — ~7 tenants dropping uploads"
	first := elide(title, 40)
	if first != elide(title, 40) {
		t.Error("the same title elided two different ways")
	}
	if widthOf(first) != 40 {
		t.Errorf("elided to %d runes, want 40: %q", widthOf(first), first)
	}
	if !strings.HasPrefix(first, "node-agent-hsh:") || !strings.HasSuffix(first, "uploads") {
		t.Errorf("elision lost an end: %q", first)
	}
	if !strings.Contains(first, ellipsis) {
		t.Errorf("nothing says the title was shortened: %q", first)
	}
	// The em dash is one rune and three bytes; a byte-wise cut would leave a
	// broken code point behind.
	for width := 1; width <= widthOf(title)+2; width++ {
		short := elide(title, width)
		if strings.ContainsRune(short, '�') {
			t.Fatalf("width %d broke a code point: %q", width, short)
		}
		if widthOf(short) > width {
			t.Fatalf("width %d produced %d runes: %q", width, widthOf(short), short)
		}
	}
}

// Every kind a lookup can conclude has a short label on the row and its own
// sentence under the list. Walking the exported order is how a kind added
// upstream is caught here rather than drawn as an empty column.
func TestEveryRunLabelIsDrawn(t *testing.T) {
	for _, kind := range nomistakes.Order {
		row := item("demo-alpha-a1", "", "the exact words for "+string(kind))
		row.Attach.Kind = kind
		if kind == nomistakes.Ready {
			row = item("demo-alpha-a1", "01AAAAAAAAAAAAAAAAAAAAAAAA", "")
		}
		source := newLoads([]app.Item{row})
		model := listed(t, source)
		sized, _ := model.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
		view := sized.(Model).View()

		if !strings.Contains(rowLines(t, view)[0], kind.Label()) {
			t.Errorf("%q is not on the row:\n%s", kind.Label(), view)
		}
		if !strings.Contains(view, "run     : "+kind.Label()) {
			t.Errorf("%q is not in the detail block:\n%s", kind.Label(), view)
		}
		if kind != nomistakes.Ready && !strings.Contains(view, row.Attach.Why) {
			t.Errorf("the exact reason for %q was dropped:\n%s", kind.Label(), view)
		}
	}
}

// An Attach nothing filled in must never read as the one kind Enter acts on.
func TestAnUnfilledAttachIsNotReady(t *testing.T) {
	if got := nomistakes.Availability("").Label(); got != nomistakes.Failed.Label() {
		t.Errorf("the zero kind reads as %q", got)
	}
	blank := app.Item{Row: attachable.Row}
	if runKind(blank) == nomistakes.Ready {
		t.Error("a row with no run was labelled ready")
	}
}
