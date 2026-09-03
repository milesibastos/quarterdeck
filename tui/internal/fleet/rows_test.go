package fleet

import "testing"

func rows(t *testing.T) []Row {
	t.Helper()
	snapshot, err := Parse(readFixture(t, "snapshot.json"), "fixture")
	if err != nil {
		t.Fatalf("parsing: %v", err)
	}
	return ActiveRows(snapshot)
}

// Everything still in progress, and nothing that finished - including the work
// item in a state this build has never seen, because a state nobody recognises
// is work nobody would otherwise be able to see.
func TestActiveRowsKeepsWorkInProgress(t *testing.T) {
	var ids []string
	for _, row := range rows(t) {
		ids = append(ids, row.ID)
	}
	want := []string{
		"demo-alpha-a1",
		"demo-alpha-a10",
		"demo-beacon-b2",
		"demo-cutter-c3",
		"demo-ensign-e5",
	}
	if len(ids) != len(want) {
		t.Fatalf("rows = %v, want %v", ids, want)
	}
	for i, id := range want {
		if ids[i] != id {
			t.Errorf("row %d = %q, want %q", i, ids[i], id)
		}
	}
}

func TestRowFields(t *testing.T) {
	byID := map[string]Row{}
	for _, row := range rows(t) {
		byID[row.ID] = row
	}

	// A live fleet joins the hand-written queue row on, so the title is the
	// operator's own sentence.
	alpha := byID["demo-alpha-a1"]
	if alpha.Title != "Draw the lifecycle rail" {
		t.Errorf("title = %q", alpha.Title)
	}
	// A project is drawn by its name. The path upstream records names a
	// machine, and a machine path never reaches the screen.
	if alpha.Project != "almanac" {
		t.Errorf("project = %q, want almanac", alpha.Project)
	}
	if alpha.State != "working" || alpha.Detail != "harness busy" {
		t.Errorf("state = %q, detail = %q", alpha.State, alpha.Detail)
	}
	if alpha.Worktree != "/opt/worktrees/demo-alpha-a1" || alpha.Remote != "" {
		t.Errorf("worktree = %q, remote = %q", alpha.Worktree, alpha.Remote)
	}

	// The fixtures carry no queue row, so the identifier is the title. A row
	// with no name at all would be a row nobody could pick.
	if ten := byID["demo-alpha-a10"]; ten.Title != "demo-alpha-a10" {
		t.Errorf("title without a queue row = %q", ten.Title)
	}
	if ten := byID["demo-alpha-a10"]; ten.Project != "almanac" {
		t.Errorf("project from a bare name = %q", ten.Project)
	}

	if remote := byID["demo-beacon-b2"]; remote.Remote != "another-machine" {
		t.Errorf("remote = %q", remote.Remote)
	}

	// Upstream said the worktree is gone, so the row carries no directory to
	// look a run up in.
	if gone := byID["demo-cutter-c3"]; gone.Worktree != "" {
		t.Errorf("a worktree upstream reports absent came through as %q", gone.Worktree)
	}

	if odd := byID["demo-ensign-e5"]; odd.State != "a-state-from-a-later-upstream" {
		t.Errorf("unknown state = %q", odd.State)
	}
}

// A worker upstream reports with no state at all is still work in progress.
func TestRowStateFallsBackToUnknown(t *testing.T) {
	built := ActiveRows(Snapshot{Tasks: []Task{{ID: "demo-alpha-a1"}}})
	if len(built) != 1 || built[0].State != "unknown" {
		t.Fatalf("rows = %+v", built)
	}
}
