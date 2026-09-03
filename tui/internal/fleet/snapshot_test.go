package fleet

import (
	"os"
	"strings"
	"testing"
)

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatalf("reading fixture: %v", err)
	}
	return raw
}

// The fixture carries a top-level key and per-task keys this build has never
// heard of. An upstream that adds a field must not break a reader that does
// not want it, which is the whole reason nothing here is decoded strictly.
func TestParseIgnoresUnknownFields(t *testing.T) {
	snapshot, err := Parse(readFixture(t, "snapshot.json"), "fixture")
	if err != nil {
		t.Fatalf("parsing a snapshot with added fields: %v", err)
	}
	if snapshot.Schema != SchemaID {
		t.Errorf("schema = %q, want %q", snapshot.Schema, SchemaID)
	}
	if len(snapshot.Tasks) != 6 {
		t.Fatalf("tasks = %d, want 6", len(snapshot.Tasks))
	}
	first := snapshot.Tasks[0]
	if first.ID != "demo-alpha-a1" || first.Backlog.Title != "Draw the lifecycle rail" {
		t.Errorf("first task = %+v", first)
	}
	if first.Paths.Worktree.Path != "/opt/worktrees/demo-alpha-a1" || !first.Paths.Worktree.Present {
		t.Errorf("first worktree = %+v", first.Paths.Worktree)
	}
}

func TestParseRefusesAnotherSchema(t *testing.T) {
	_, err := Parse(readFixture(t, "mismatched.json"), "fixture")
	if err == nil {
		t.Fatal("a snapshot announcing another schema was accepted")
	}
	if !strings.Contains(err.Error(), SchemaID) || !strings.Contains(err.Error(), "fm-fleet-snapshot.v2") {
		t.Errorf("refusal names neither identifier: %v", err)
	}
}

func TestParseRefusesRubbish(t *testing.T) {
	if _, err := Parse([]byte("{ not json"), "fixture"); err == nil {
		t.Fatal("unparseable bytes were accepted")
	}
}

// A missing schema is the shape a half-written file has, and it is refused for
// the same reason a changed one is: nothing downstream re-checks it.
func TestParseRefusesNoSchema(t *testing.T) {
	if _, err := Parse([]byte(`{"tasks":[]}`), "fixture"); err == nil {
		t.Fatal("a snapshot with no schema identifier was accepted")
	}
}
