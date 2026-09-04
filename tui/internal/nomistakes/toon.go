// Package nomistakes joins a work item to its no-mistakes pipeline run and
// builds the command that hands the terminal over to it.
//
// Everything here goes through no-mistakes' own agent interface - `no-mistakes
// axi status`, which exists to be read by a program and prints TOON - and
// through `no-mistakes attach`, which is the published way to open a run's
// TUI. Nothing reads no-mistakes' database, and nothing is ever started or
// restarted: the daemon is one instance serving every repository on this
// machine.
package nomistakes

import (
	"regexp"
	"strconv"
	"strings"
)

// tableHeader is TOON's tabular form: a name, the number of rows, and the
// columns, e.g. `runs[10]{id,branch,status,head,pr}:`. The rows follow it,
// indented, one per line.
var tableHeader = regexp.MustCompile(`^(\s*)([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]\{([^}]*)\}:\s*$`)

var scalarLine = regexp.MustCompile(`^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$`)

// nestedField is the same `name: value` one indent in, which is how the fields
// of a nested object arrive.
var nestedField = regexp.MustCompile(`^([ \t]+)([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$`)

// Run is one pipeline run, as `axi status` lists it.
type Run struct {
	ID     string
	Branch string
	Status string
}

// Status is what one `axi status` read said.
//
// `axi status` prints one of two shapes, and both are read here. When the
// branch it is standing on has a run it describes that one run in a nested
// `run:` object; when it has none it falls back to the overview - the scalars
// and a bounded table. Detailed says which arrived, and Current is the object's
// run. Detailed with an empty Current is a third answer and not a fourth
// silence: the shape was understood and what it carried was incomplete, which
// a caller must not report as a branch with no run.
//
// The runs are gathered from every table that names both a run and its branch,
// so a release that splits the current branch's runs into a table of their own
// is read the same way as one that prints a single list. RunsOnCurrentBranch
// is upstream's own count and is kept apart from the rows, because the two
// disagreeing is a fact worth telling the operator rather than smoothing over:
// the listing is bounded and the count is not.
type Status struct {
	CurrentBranch       string
	RunsOnCurrentBranch int
	CountedRuns         bool
	Detailed            bool
	Current             Run
	Runs                []Run
}

// ParseStatus reads the TOON `axi status` prints.
//
// Deliberately shape-tolerant in one direction only: an unfamiliar table or an
// added column is skipped, while a table carrying `id` and `branch` is read
// whatever it is called and whatever order its columns are in. What it will
// not do is guess - a row without both fields contributes nothing.
func ParseStatus(out string) Status {
	status := Status{}
	lines := strings.Split(out, "\n")
	for i := 0; i < len(lines); i++ {
		if strings.TrimRight(lines[i], " \t") == "run:" {
			run, consumed := readNestedRun(lines[i+1:])
			status.Detailed, status.Current = true, run
			i += consumed
			continue
		}
		if header := tableHeader.FindStringSubmatch(lines[i]); header != nil {
			count, _ := strconv.Atoi(header[3])
			runs, consumed := readRuns(lines[i+1:], count, splitFields(header[4]))
			status.Runs = append(status.Runs, runs...)
			i += consumed
			continue
		}
		readScalar(&status, lines[i])
	}
	return status
}

func readScalar(status *Status, line string) {
	scalar := scalarLine.FindStringSubmatch(line)
	if scalar == nil {
		return
	}
	value := strings.TrimSpace(scalar[2])
	switch scalar[1] {
	case "current_branch":
		status.CurrentBranch = unquote(value)
	case "runs_on_current_branch":
		if count, err := strconv.Atoi(value); err == nil {
			status.RunsOnCurrentBranch = count
			status.CountedRuns = true
		}
	}
}

// readNestedRun reads the object under a top-level `run:`, and reports how many
// lines it consumed so the scan resumes past the whole block.
//
// The whole block, because a run object carries a table of its own - the
// pipeline steps - and a table header is recognised at any indent. Leaving the
// block to the outer scan would offer that table to the run reader, which is
// how a parser starts answering about something it was never asked about.
//
// Only the object's own fields are read: the first indent seen is the object's,
// and anything deeper belongs to something nested inside it. `branch_sync`
// names a branch two levels down, and it is not this run's branch.
func readNestedRun(lines []string) (Run, int) {
	run := Run{}
	indent := ""
	known := false
	read := 0
	for read < len(lines) {
		line := lines[read]
		if strings.TrimSpace(line) == "" || !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") {
			break
		}
		read++
		field := nestedField.FindStringSubmatch(line)
		if field == nil {
			continue
		}
		if !known {
			indent, known = field[1], true
		}
		if field[1] == indent {
			assign(&run, field[2], unquote(strings.TrimSpace(field[3])))
		}
	}
	return run, read
}

// readRuns takes the rows under one table header, and reports how many lines
// it consumed so the scan resumes after them.
func readRuns(lines []string, count int, columns []string) ([]Run, int) {
	var runs []Run
	read := 0
	for read < len(lines) && len(runs) < count {
		line := lines[read]
		if strings.TrimSpace(line) == "" || !strings.HasPrefix(line, " ") {
			break
		}
		read++
		if run, ok := runFrom(columns, splitFields(strings.TrimSpace(line))); ok {
			runs = append(runs, run)
		}
	}
	return runs, read
}

func runFrom(columns, fields []string) (Run, bool) {
	if len(fields) != len(columns) {
		return Run{}, false
	}
	run := Run{}
	for i, column := range columns {
		assign(&run, column, fields[i])
	}
	return run, run.ID != "" && run.Branch != ""
}

// assign fills in the three fields this program has a use for, by the name
// upstream gave them. A field it does not know is not an error - it is one of
// the several a run carries that no operator decision here depends on.
func assign(run *Run, name, value string) {
	switch name {
	case "id":
		run.ID = value
	case "branch":
		run.Branch = value
	case "status":
		run.Status = value
	}
}

// splitFields splits one TOON row on commas, honouring the double quotes it
// puts around a value that contains one.
func splitFields(row string) []string {
	var fields []string
	var field strings.Builder
	quoted := false
	for _, r := range row {
		switch {
		case r == '"':
			quoted = !quoted
		case r == ',' && !quoted:
			fields = append(fields, strings.TrimSpace(field.String()))
			field.Reset()
		default:
			field.WriteRune(r)
		}
	}
	fields = append(fields, strings.TrimSpace(field.String()))
	return fields
}

func unquote(value string) string {
	return strings.Trim(value, `"`)
}
