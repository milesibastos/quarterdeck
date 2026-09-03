// Package app joins the two reads the list is built from: the fleet snapshot,
// and no-mistakes' answer about each work item's run.
//
// Both are reads. Nothing in this package writes a file, steers a worker or
// starts anything; the one thing this program runs on purpose is `no-mistakes
// attach`, and that happens only when an operator presses Enter.
package app

import (
	"context"
	"os"
	"sync"

	"github.com/milesibastos/quarterdeck/tui/internal/fleet"
	"github.com/milesibastos/quarterdeck/tui/internal/nomistakes"
)

// lookups is how many work items are asked about at once. Enough that a fleet
// of a dozen refreshes promptly, small enough that a refresh is not a burst of
// processes against one daemon.
const lookups = 4

// Item is one row of the list, with the attach decision already made.
type Item struct {
	fleet.Row
	Attach nomistakes.Attach
}

// Attachable reports whether Enter has anything to open.
func (i Item) Attachable() bool { return i.Attach.RunID != "" }

// Loader reads the fleet and resolves every row's run.
type Loader struct {
	Source   fleet.Source
	Resolver nomistakes.Resolver
	// DirExists reports whether a worktree is still on disk. Injected, and
	// nil means the real filesystem.
	DirExists func(path string) bool
}

// present is the check that keeps a lookup from being made in a directory that
// is not there. Upstream reports a worktree as present as of its own read, and
// a run finishing between that read and this one is the ordinary case rather
// than the odd one.
func (l Loader) present(path string) bool {
	if l.DirExists != nil {
		return l.DirExists(path)
	}
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// Load is one refresh: one snapshot, then one lookup per active work item.
//
// A snapshot that cannot be read is the whole list failing, because there is
// nothing to draw. A lookup that cannot be answered is one row's action being
// unavailable, and the row stays.
func (l Loader) Load(ctx context.Context) ([]Item, error) {
	snapshot, err := l.Source.Read(ctx)
	if err != nil {
		return nil, err
	}
	rows := fleet.ActiveRows(snapshot)
	items := make([]Item, len(rows))
	for i, row := range rows {
		items[i] = Item{Row: row}
	}
	l.resolveAll(ctx, items)
	return items, nil
}

// resolveAll fills in each item's attach decision, in place, so the list keeps
// the order upstream reported.
func (l Loader) resolveAll(ctx context.Context, items []Item) {
	var wait sync.WaitGroup
	slots := make(chan struct{}, lookups)
	for i := range items {
		wait.Add(1)
		slots <- struct{}{}
		go func(item *Item) {
			defer wait.Done()
			defer func() { <-slots }()
			item.Attach = l.attachFor(ctx, item.Row)
		}(&items[i])
	}
	wait.Wait()
}

// attachFor is the decision for one row.
//
// The two cases that need no lookup are refused before one is made: a remote
// worker's terminal is not this terminal's to hand over, and a worktree
// upstream says is gone is not somewhere a run can be looked up.
func (l Loader) attachFor(ctx context.Context, row fleet.Row) nomistakes.Attach {
	if row.Remote != "" {
		return nomistakes.Attach{Why: "runs on another machine; attach is local only"}
	}
	if row.Worktree == "" || !l.present(row.Worktree) {
		return nomistakes.Attach{Why: "its worktree is gone"}
	}
	return l.Resolver.Resolve(ctx, row.Worktree, nomistakes.BranchFor(row.ID))
}
