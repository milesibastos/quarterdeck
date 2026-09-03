package ui

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/milesibastos/quarterdeck/tui/internal/app"
	"github.com/milesibastos/quarterdeck/tui/internal/fleet"
	"github.com/milesibastos/quarterdeck/tui/internal/nomistakes"
)

// loads counts the reads the model actually started, which is what the
// no-overlap and refresh-on-return rules are about. A read blocks until it is
// released, so a test can hold one open and watch what the model does while it
// is in flight.
type loads struct {
	mu       sync.Mutex
	started  int
	items    []app.Item
	err      error
	hold     chan struct{}
	entered  chan struct{}
	blocking bool
}

func newLoads(items []app.Item) *loads {
	return &loads{items: items, hold: make(chan struct{}), entered: make(chan struct{}, 8)}
}

func (l *loads) load(context.Context) ([]app.Item, error) {
	l.mu.Lock()
	l.started++
	blocking := l.blocking
	l.mu.Unlock()
	l.entered <- struct{}{}
	if blocking {
		<-l.hold
	}
	return l.items, l.err
}

func (l *loads) count() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.started
}

// run executes a command, unwrapping a batch. A command that has not answered
// promptly is a timer rather than a read, and contributes no message - which
// is what keeps a test off the refresh interval's clock.
func run(cmd tea.Cmd) []tea.Msg {
	if cmd == nil {
		return nil
	}
	answered := make(chan tea.Msg, 1)
	go func() { answered <- cmd() }()
	select {
	case msg := <-answered:
		if batch, ok := msg.(tea.BatchMsg); ok {
			var msgs []tea.Msg
			for _, inner := range batch {
				msgs = append(msgs, run(inner)...)
			}
			return msgs
		}
		return []tea.Msg{msg}
	case <-time.After(250 * time.Millisecond):
		return nil
	}
}

func item(id, runID, why string) app.Item {
	return app.Item{
		Row: fleet.Row{
			ID:       id,
			Title:    id,
			Project:  "almanac",
			State:    "working",
			Worktree: "/opt/worktrees/" + id,
		},
		Attach: nomistakes.Attach{RunID: runID, Why: why},
	}
}

var (
	attachable = item("demo-alpha-a1", "01AAAAAAAAAAAAAAAAAAAAAAAA", "")
	waiting    = item("demo-alpha-a10", "", "no no-mistakes run on fm/demo-alpha-a10")
)

// listed is a model that has already had its first read answered.
func listed(t *testing.T, source *loads) Model {
	t.Helper()
	model := New(source.load, "fleet")
	next, _ := model.Update(itemsMsg{items: source.items})
	return next.(Model)
}

func TestListedRowsAndKeys(t *testing.T) {
	source := newLoads([]app.Item{attachable, waiting})
	model := listed(t, source)

	if model.cursor != 0 {
		t.Fatalf("cursor = %d", model.cursor)
	}
	next, _ := model.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})
	model = next.(Model)
	if model.cursor != 1 || model.selected != "demo-alpha-a10" {
		t.Errorf("after j: cursor = %d, selected = %q", model.cursor, model.selected)
	}
	next, _ = model.Update(tea.KeyMsg{Type: tea.KeyDown})
	if next.(Model).cursor != 1 {
		t.Error("down ran off the end of the list")
	}
	next, _ = model.Update(tea.KeyMsg{Type: tea.KeyUp})
	if next.(Model).cursor != 0 {
		t.Error("up did not move")
	}
	next, _ = model.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'k'}})
	if next.(Model).cursor != 0 {
		t.Error("k ran off the top of the list")
	}

	if _, cmd := model.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}}); cmd == nil {
		t.Error("q did not quit")
	}
	if _, cmd := model.Update(tea.KeyMsg{Type: tea.KeyCtrlC}); cmd == nil {
		t.Error("ctrl+c did not quit")
	}
}

func TestRefreshOnDemand(t *testing.T) {
	source := newLoads([]app.Item{attachable})
	model := listed(t, source)
	_, cmd := model.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'r'}})
	run(cmd)
	if source.count() != 1 {
		t.Errorf("reads started = %d, want 1", source.count())
	}
}

// Enter is the only thing that hands the terminal over, and only on a row
// that has a run. A row with a reason instead does nothing at all.
func TestEnterOnlyOpensWhatCanBeOpened(t *testing.T) {
	source := newLoads([]app.Item{attachable, waiting})
	model := listed(t, source)

	moved, _ := model.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})
	after, cmd := moved.(Model).Update(tea.KeyMsg{Type: tea.KeyEnter})
	if cmd != nil {
		t.Error("Enter on a row with no run started something")
	}
	if after.(Model).childRunning {
		t.Error("a row with no run was treated as handed over")
	}

	opened, cmd := model.Update(tea.KeyMsg{Type: tea.KeyEnter})
	if cmd == nil {
		t.Fatal("Enter on an attachable row did nothing")
	}
	if !opened.(Model).childRunning {
		t.Error("the model does not know a child owns the terminal")
	}
}

// While no-mistakes owns the terminal, a tick refreshes nothing and arms
// nothing: the child exiting is what starts the clock again.
func TestNoRefreshWhileTheChildOwnsTheTerminal(t *testing.T) {
	source := newLoads([]app.Item{attachable})
	model := listed(t, source)
	opened, _ := model.Update(tea.KeyMsg{Type: tea.KeyEnter})

	ticked, cmd := opened.(Model).Update(tickMsg{})
	if msgs := run(cmd); len(msgs) != 0 {
		t.Errorf("a tick during the handover produced %v", msgs)
	}
	if source.count() != 0 {
		t.Errorf("reads started = %d, want none", source.count())
	}
	if !ticked.(Model).childRunning {
		t.Error("the tick cleared the handover")
	}
}

// Coming back from no-mistakes re-reads the fleet, because what the operator
// just watched may well have moved it.
func TestReturningFromTheChildRefreshes(t *testing.T) {
	source := newLoads([]app.Item{attachable})
	model := listed(t, source)
	opened, _ := model.Update(tea.KeyMsg{Type: tea.KeyEnter})

	returned, cmd := opened.(Model).Update(childDoneMsg{})
	back := returned.(Model)
	if back.childRunning {
		t.Error("the model still thinks the child owns the terminal")
	}
	if back.childErr != "" {
		t.Errorf("a clean exit was reported as a failure: %q", back.childErr)
	}
	msgs := run(cmd)
	if source.count() != 1 {
		t.Errorf("reads started = %d, want 1", source.count())
	}
	if len(msgs) != 1 {
		t.Fatalf("messages = %v", msgs)
	}
	if _, ok := msgs[0].(itemsMsg); !ok {
		t.Errorf("returning produced %T, want a fresh list", msgs[0])
	}
}

// A child that failed is a sentence in the footer, not a dead list.
func TestAChildThatFailedIsReported(t *testing.T) {
	source := newLoads([]app.Item{attachable})
	model := listed(t, source)
	opened, _ := model.Update(tea.KeyMsg{Type: tea.KeyEnter})
	returned, _ := opened.(Model).Update(childDoneMsg{err: errors.New("exit status 2")})
	back := returned.(Model)
	if !strings.Contains(back.childErr, "exit status 2") {
		t.Errorf("childErr = %q", back.childErr)
	}
	if !strings.Contains(back.View(), "exit status 2") {
		t.Error("the failure is not on screen")
	}
}

// A read already in flight is never joined by a second one.
func TestRefreshesDoNotOverlap(t *testing.T) {
	source := newLoads([]app.Item{attachable})
	source.blocking = true
	model := listed(t, source)

	pressed, first := model.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'r'}})
	go run(first)
	<-source.entered

	// Everything below is asked of the state that first press left behind: a
	// model with a read already in flight.
	inFlight := pressed.(Model)
	_, second := inFlight.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'r'}})
	run(second)
	_, ticked := inFlight.Update(tickMsg{})
	run(ticked)

	if source.count() != 1 {
		t.Errorf("reads started = %d, want 1 while one is in flight", source.count())
	}
	close(source.hold)
}

// The operator keeps their place across a refresh, and lands somewhere sane
// when the work item they were on has finished.
func TestSelectionSurvivesARefresh(t *testing.T) {
	source := newLoads([]app.Item{attachable, waiting})
	model := listed(t, source)
	moved, _ := model.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})

	same, _ := moved.(Model).Update(itemsMsg{items: []app.Item{waiting, attachable}})
	if same.(Model).cursor != 0 || same.(Model).selected != "demo-alpha-a10" {
		t.Errorf("the operator's place moved with the list: %+v", same.(Model).cursor)
	}

	gone, _ := same.(Model).Update(itemsMsg{items: []app.Item{attachable}})
	if gone.(Model).cursor != 0 || gone.(Model).selected != "demo-alpha-a1" {
		t.Errorf("cursor = %d, selected = %q", gone.(Model).cursor, gone.(Model).selected)
	}

	empty, _ := gone.(Model).Update(itemsMsg{items: nil})
	if empty.(Model).cursor != 0 {
		t.Errorf("cursor on an empty list = %d", empty.(Model).cursor)
	}
}

// A fleet that cannot be read says so, and says it where the list would be.
func TestAFleetThatCannotBeRead(t *testing.T) {
	source := newLoads(nil)
	model := New(source.load, "fleet")
	failed, _ := model.Update(itemsMsg{err: errors.New("reading fleet:fleet: no such file")})
	view := failed.(Model).View()
	if !strings.Contains(view, "could not be read") || !strings.Contains(view, "no such file") {
		t.Errorf("view = %q", view)
	}
}

func TestTheViewNamesEveryRowAndItsAction(t *testing.T) {
	source := newLoads([]app.Item{attachable, waiting})
	model := listed(t, source)
	next, _ := model.Update(tea.WindowSizeMsg{Width: 120, Height: 40})
	view := next.(Model).View()

	for _, want := range []string{
		"fleet",
		"2 work items in progress",
		"> demo-alpha-a1",
		"almanac",
		"working",
		openable,
		"no no-mistakes run on fm/demo-alpha-a10",
		"enter opens no-mistakes",
	} {
		if !strings.Contains(view, want) {
			t.Errorf("view does not say %q:\n%s", want, view)
		}
	}
}

// A narrow terminal cuts a line rather than wrapping it into a second row that
// looks like another work item.
func TestTheViewFitsTheTerminal(t *testing.T) {
	source := newLoads([]app.Item{attachable, waiting})
	model := listed(t, source)
	next, _ := model.Update(tea.WindowSizeMsg{Width: 24, Height: 10})
	for _, line := range strings.Split(next.(Model).View(), "\n") {
		if len([]rune(line)) > 24 {
			t.Errorf("line is %d wide: %q", len([]rune(line)), line)
		}
	}
}

func TestAnEmptyFleetSaysSo(t *testing.T) {
	source := newLoads(nil)
	model := listed(t, source)
	if !strings.Contains(model.View(), "Nothing is in progress") {
		t.Errorf("view = %q", model.View())
	}
}
