// Package ui is the list itself: what is drawn, which keys move it, and the
// one moment it stops being the program on screen.
//
// The handover is Bubble Tea's own: `tea.ExecProcess` releases the terminal,
// runs no-mistakes attached to the terminal it just released, and gives it
// back. Nothing here restores a terminal by hand, and nothing here draws a
// no-mistakes screen - the whole point is that the operator gets the real one.
package ui

import (
	"context"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/milesibastos/quarterdeck/tui/internal/app"
	"github.com/milesibastos/quarterdeck/tui/internal/nomistakes"
)

// RefreshInterval is the periodic re-read.
//
// Well above the two seconds a refresh may not beat, because one refresh is a
// snapshot command plus a lookup per work item: this is a panel watching a
// fleet, not a poller. It never overlaps itself and never runs while
// no-mistakes owns the terminal - both are the model's own state, checked
// before a tick turns into a read.
const RefreshInterval = 8 * time.Second

// Item is one row of the list. Aliased so the drawing code reads as one
// vocabulary rather than as two packages meeting.
type Item = app.Item

// Load is one refresh, injected so the model can be driven with no fleet, no
// daemon and no terminal.
type Load func(ctx context.Context) ([]app.Item, error)

type itemsMsg struct {
	items []app.Item
	err   error
}

type tickMsg struct{}

type childDoneMsg struct{ err error }

// Model is the whole list.
type Model struct {
	load  Load
	label string

	items    []app.Item
	cursor   int
	selected string

	// loading and childRunning are the two reasons a tick does not become a
	// read: a refresh already in flight, and a child that owns the terminal.
	loading      bool
	childRunning bool

	loaded   bool
	loadErr  string
	childErr string

	width  int
	height int
}

// New is the model before its first read. It starts marked as loading because
// Init's first act is that read, and a tick arriving before the read answered
// would otherwise start a second one.
func New(load Load, label string) Model {
	return Model{load: load, label: label, loading: true}
}

// Init starts the first read and arms the tick.
func (m Model) Init() tea.Cmd {
	return tea.Batch(loadCmd(m.load), tick())
}

// Update is the one dispatcher; each message has its own handler below.
func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		return m, nil
	case tea.KeyMsg:
		return m.key(msg)
	case itemsMsg:
		return m.received(msg), nil
	case tickMsg:
		return m.ticked()
	case childDoneMsg:
		return m.childDone(msg)
	}
	return m, nil
}

func (m Model) key(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "q", "ctrl+c":
		return m, tea.Quit
	case "up", "k":
		return m.move(-1), nil
	case "down", "j":
		return m.move(1), nil
	case "r":
		// The last handover's failure is dismissed here rather than by the
		// refresh that follows a child exiting - that one happens immediately,
		// and would wipe the message before it was read. Asking for a fresh
		// list is the operator saying they have read it.
		m.childErr = ""
		cmd := m.refresh()
		return m, cmd
	case "enter":
		return m.open()
	}
	return m, nil
}

func (m Model) move(by int) Model {
	if len(m.items) == 0 {
		return m
	}
	m.cursor = clamp(m.cursor+by, len(m.items))
	m.selected = m.items[m.cursor].ID
	return m
}

// open hands the terminal over, and only ever on Enter.
//
// A row with nothing to attach to does nothing at all: the reason is already
// on the row, and guessing at a run would be worse than the honest refusal.
func (m Model) open() (tea.Model, tea.Cmd) {
	if m.childRunning || len(m.items) == 0 {
		return m, nil
	}
	item := m.items[m.cursor]
	if !item.Attachable() {
		return m, nil
	}
	m.childRunning = true
	m.childErr = ""
	command := nomistakes.AttachCommand(item.Attach.RunID, item.Worktree)
	return m, tea.ExecProcess(command, func(err error) tea.Msg {
		return childDoneMsg{err: err}
	})
}

// received keeps the operator's place across a refresh: the same work item if
// it is still there, and otherwise the nearest row to where they were.
func (m Model) received(msg itemsMsg) Model {
	m.loading = false
	m.loaded = true
	if msg.err != nil {
		m.loadErr = msg.err.Error()
		return m
	}
	m.loadErr = ""
	m.items = msg.items
	m.cursor = clamp(m.indexOf(m.selected), len(m.items))
	if len(m.items) > 0 {
		m.selected = m.items[m.cursor].ID
	}
	return m
}

func (m Model) indexOf(id string) int {
	for i, item := range m.items {
		if item.ID == id {
			return i
		}
	}
	return m.cursor
}

// ticked is the periodic read, and the two guards on it. A tick that arrives
// while no-mistakes owns the terminal, or while a read is already in flight,
// arms the next one and reads nothing.
//
// Every path through here arms exactly one tick and nothing else ever arms
// one, which is what keeps the program to a single chain: arming a second on
// the way back from a handover would halve the interval, and halve it again on
// the next one.
func (m Model) ticked() (tea.Model, tea.Cmd) {
	if m.childRunning {
		return m, tick()
	}
	if m.loading {
		return m, tick()
	}
	cmd := m.refresh()
	return m, tea.Batch(cmd, tick())
}

// childDone is the return: the list comes back, re-reads the fleet because
// what the operator just watched may well have moved it, and says so if
// no-mistakes itself failed.
func (m Model) childDone(msg childDoneMsg) (tea.Model, tea.Cmd) {
	m.childRunning = false
	m.childErr = ""
	if msg.err != nil {
		m.childErr = msg.err.Error()
	}
	cmd := m.refresh()
	return m, cmd
}

// refresh starts a read unless one is already in flight, which is the whole of
// the no-overlap rule.
func (m *Model) refresh() tea.Cmd {
	if m.loading {
		return nil
	}
	m.loading = true
	return loadCmd(m.load)
}

func loadCmd(load Load) tea.Cmd {
	return func() tea.Msg {
		items, err := load(context.Background())
		return itemsMsg{items: items, err: err}
	}
}

func tick() tea.Cmd {
	return tea.Tick(RefreshInterval, func(time.Time) tea.Msg { return tickMsg{} })
}

func clamp(index, length int) int {
	if length == 0 {
		return 0
	}
	if index < 0 {
		return 0
	}
	if index >= length {
		return length - 1
	}
	return index
}
