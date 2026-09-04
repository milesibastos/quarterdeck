package ui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/milesibastos/quarterdeck/tui/internal/app"
	"github.com/milesibastos/quarterdeck/tui/internal/nomistakes"
)

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
}

// The em dash is one rune and three bytes; a byte-wise cut would leave a
// broken code point behind, at some width nobody thought to try.
func TestElisionIsUnicodeSafeAtEveryWidth(t *testing.T) {
	const title = "node-agent-hsh: btrfs /@/var mounted read-only — ~7 tenants dropping uploads"
	for width := 1; width <= widthOf(title)+2; width++ {
		short := elide(title, width)
		if strings.ContainsRune(short, '\uFFFD') {
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
		row := rowOfKind(kind)
		source := newLoads([]app.Item{row})
		sized, _ := listed(t, source).Update(tea.WindowSizeMsg{Width: 120, Height: 40})
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

func rowOfKind(kind nomistakes.Availability) app.Item {
	if kind == nomistakes.Ready {
		return item("demo-alpha-a1", "01AAAAAAAAAAAAAAAAAAAAAAAA", "")
	}
	row := item("demo-alpha-a1", "", "the exact words for "+string(kind))
	row.Attach.Kind = kind
	return row
}

// An Attach nothing filled in must never read as the one kind Enter acts on.
func TestAnUnfilledAttachIsNotReady(t *testing.T) {
	if got := nomistakes.Availability("").Label(); got != nomistakes.Failed.Label() {
		t.Errorf("the zero kind reads as %q", got)
	}
	if runKind(app.Item{Row: attachable.Row}) == nomistakes.Ready {
		t.Error("a row with no run was labelled ready")
	}
}
