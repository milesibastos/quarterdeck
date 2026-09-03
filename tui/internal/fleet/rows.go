package fleet

// finished names the three states a worker has left the track in. Everything
// else - working, dispatched, validating, parked, blocked, paused, waiting on
// something outside, or a state this build has never heard of - is work in
// progress and stays on the list. Choosing what to drop rather than what to
// keep is deliberate: an unrecognised state is work nobody can see if the
// filter is a whitelist.
var finished = map[string]bool{
	"done":   true,
	"failed": true,
	"landed": true,
}

// Row is one line of the list.
//
// It carries what is drawn plus the two facts the attach decision needs - the
// worktree to run in, and whether the worker is on this machine at all.
type Row struct {
	ID      string
	Title   string
	Project string
	State   string
	Detail  string
	// Worktree is the directory a run is looked up and attached in, and "" when
	// upstream reports the worker's worktree is gone.
	Worktree string
	// Remote names the machine the worker runs on, and is "" for a local one.
	Remote string
}

// ActiveRows is every worker still in progress, in the order upstream reported
// them - including the ones whose no-mistakes run has not started, which are
// exactly the ones an operator is waiting on.
func ActiveRows(snapshot Snapshot) []Row {
	rows := make([]Row, 0, len(snapshot.Tasks))
	for _, task := range snapshot.Tasks {
		if finished[task.CurrentState.State] {
			continue
		}
		rows = append(rows, rowFor(task))
	}
	return rows
}

func rowFor(task Task) Row {
	title := task.Backlog.Title
	if title == "" {
		title = task.ID
	}
	state := task.CurrentState.State
	if state == "" {
		state = "unknown"
	}
	row := Row{
		ID:      task.ID,
		Title:   title,
		Project: lastSegment(task.Project),
		State:   state,
		Detail:  task.CurrentState.Detail,
	}
	if task.Paths.Worktree.Present {
		row.Worktree = task.Paths.Worktree.Path
	}
	if task.Remote != nil {
		row.Remote = *task.Remote
	}
	return row
}
