package app

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/milesibastos/quarterdeck/tui/internal/fleet"
	"github.com/milesibastos/quarterdeck/tui/internal/nomistakes"
)

// A listing holding one run per local work item, so that a row which is asked
// about at all comes back attachable and the disabled rows are disabled for
// their own reason rather than for want of a run.
const listing = `current_branch: fm/demo-alpha-a1
runs_on_current_branch: 1
runs[3]{id,branch,status}:
  01AAAAAAAAAAAAAAAAAAAAAAAA,fm/demo-alpha-a1,running
  01BBBBBBBBBBBBBBBBBBBBBBBB,fm/demo-alpha-a10,completed
  01CCCCCCCCCCCCCCCCCCCCCCCC,fm/demo-ensign-e5,running
`

type asked struct {
	mu   sync.Mutex
	dirs []string
}

func (a *asked) runner(out string, err error) nomistakes.Runner {
	return func(_ context.Context, dir string, _ ...string) (string, error) {
		a.mu.Lock()
		a.dirs = append(a.dirs, dir)
		a.mu.Unlock()
		return out, err
	}
}

func (a *asked) seen(dir string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, seen := range a.dirs {
		if seen == dir {
			return true
		}
	}
	return false
}

// fixtureSource is the snapshot the fleet package's own tests read, driven
// through the same file source the program uses when no fleet is configured.
func fixtureSource(name string) fleet.Source {
	return fleet.SourceFor(fleet.Config{
		FixtureFile: "../fleet/testdata/" + name,
		Label:       "testdata",
	})
}

func loaderReading(out string, err error, record *asked) Loader {
	return Loader{
		Source: fixtureSource("snapshot.json"),
		// Every worktree the fixture names is treated as still on disk, so
		// that the rows which refuse do so for their own stated reason.
		DirExists: func(string) bool { return true },
		Resolver: nomistakes.Resolver{
			LookPath: func(string) (string, error) { return "/somewhere/no-mistakes", nil },
			Run:      record.runner(out, err),
		},
	}
}

func itemsByID(t *testing.T, items []Item) map[string]Item {
	t.Helper()
	byID := map[string]Item{}
	for _, item := range items {
		byID[item.ID] = item
	}
	return byID
}

func TestLoadAttachesWhatItCan(t *testing.T) {
	record := &asked{}
	items, err := loaderReading(listing, nil, record).Load(context.Background())
	if err != nil {
		t.Fatalf("loading: %v", err)
	}
	byID := itemsByID(t, items)

	alpha := byID["demo-alpha-a1"]
	if !alpha.Attachable() || alpha.Attach.RunID != "01AAAAAAAAAAAAAAAAAAAAAAAA" {
		t.Errorf("alpha = %+v", alpha.Attach)
	}
	if !record.seen("/opt/worktrees/demo-alpha-a1") {
		t.Errorf("the lookup did not run in the work item's worktree: %v", record.dirs)
	}
}

// The three rows Enter does nothing on. Each stays on the list, each says its
// own reason, and none of them is a failure of the list.
func TestLoadKeepsRowsItCannotOpen(t *testing.T) {
	record := &asked{}
	items, err := loaderReading(listing, nil, record).Load(context.Background())
	if err != nil {
		t.Fatalf("loading: %v", err)
	}
	byID := itemsByID(t, items)

	remote := byID["demo-beacon-b2"]
	if remote.Attachable() || !strings.Contains(remote.Attach.Why, "another machine") {
		t.Errorf("remote row = %+v", remote.Attach)
	}
	if record.seen("/opt/worktrees/demo-beacon-b2") {
		t.Error("a remote worker was looked up locally anyway")
	}

	gone := byID["demo-cutter-c3"]
	if gone.Attachable() || !strings.Contains(gone.Attach.Why, "worktree is gone") {
		t.Errorf("row with no worktree = %+v", gone.Attach)
	}
	if record.seen("/opt/worktrees/demo-cutter-c3") {
		t.Error("a work item with no worktree was looked up anyway")
	}

	// A local work item whose run has not started: on the list, and honest
	// about there being nothing to open.
	notStarted := byID["demo-alpha-a10"]
	if !notStarted.Attachable() {
		t.Fatalf("the second row should have matched its own branch: %+v", notStarted.Attach)
	}
}

func TestLoadWhenTheRunHasNotStarted(t *testing.T) {
	record := &asked{}
	empty := "current_branch: fm/demo-alpha-a1\nruns_on_current_branch: 0\n"
	items, err := loaderReading(empty, nil, record).Load(context.Background())
	if err != nil {
		t.Fatalf("loading: %v", err)
	}
	byID := itemsByID(t, items)
	alpha := byID["demo-alpha-a1"]
	if alpha.Attachable() || !strings.Contains(alpha.Attach.Why, "no no-mistakes run") {
		t.Errorf("alpha = %+v", alpha.Attach)
	}
	if len(items) != 5 {
		t.Errorf("items = %d, want every work item still listed", len(items))
	}
}

// A lookup that fails everywhere is still five rows, each carrying what
// no-mistakes said. The list is what the fleet reported; no-mistakes only
// decides what Enter does.
func TestLoadSurvivesALookupThatFails(t *testing.T) {
	record := &asked{}
	items, err := loaderReading("error: daemon not running\n", errors.New("exit status 1"), record).Load(context.Background())
	if err != nil {
		t.Fatalf("a failed lookup broke the whole list: %v", err)
	}
	if len(items) != 5 {
		t.Fatalf("items = %d, want 5", len(items))
	}
	if why := itemsByID(t, items)["demo-alpha-a1"].Attach.Why; !strings.Contains(why, "daemon not running") {
		t.Errorf("why = %q", why)
	}
}

// A worktree upstream reported as present but which has since been removed is
// the same answer as one it reported gone, and is never looked up.
func TestLoadWhenTheWorktreeWentAwayAfterTheSnapshot(t *testing.T) {
	record := &asked{}
	loader := loaderReading(listing, nil, record)
	loader.DirExists = func(string) bool { return false }
	items, err := loader.Load(context.Background())
	if err != nil {
		t.Fatalf("loading: %v", err)
	}
	for _, item := range items {
		if item.Attachable() {
			t.Errorf("%s was attachable with no worktree on disk", item.ID)
		}
	}
	if len(record.dirs) != 0 {
		t.Errorf("looked up in %v", record.dirs)
	}
}

// A snapshot that cannot be read is the whole list failing, because there is
// nothing to draw.
func TestLoadFailsWhenTheFleetCannotBeRead(t *testing.T) {
	loader := Loader{
		Source: fixtureSource("mismatched.json"),
		Resolver: nomistakes.Resolver{
			LookPath: func(string) (string, error) { return "", errors.New("not found") },
		},
	}
	if _, err := loader.Load(context.Background()); err == nil {
		t.Fatal("a snapshot announcing another schema was drawn")
	}
}
