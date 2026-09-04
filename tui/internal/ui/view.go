package ui

import (
	"strconv"
	"strings"

	"github.com/milesibastos/quarterdeck/tui/internal/nomistakes"
)

// The list is drawn in text and nothing else: no colour, no box drawing, no
// second face. It sits in front of no-mistakes' own screen and hands the
// terminal to it whole, so anything it painted would be a second grammar
// competing with the one the operator actually came for.
//
// That constraint is why the layout does the work colour usually does. The
// selection is a character in the first column, the state and the run
// availability are columns of their own at a fixed offset, and the one thing
// that varies in length - the title - is last. An operator comparing four
// workers reads down a column; an operator deciding what to open reads the
// detail block under the list, where the selected row's prose is kept whole.
const (
	cursorHere = ">"
	cursorAway = " "
	// gap is the one separator between columns. Two spaces, because one reads
	// as a word break inside a title and three starts to look like a rule.
	gap = "  "
)

// wideColumns is where the one-line table stops fitting.
//
// Below it the same fields are drawn over two lines rather than squeezed:
// squeezing costs the title first and then, silently, the two columns an
// operator is actually comparing. The number is the width at which the four
// metadata columns plus a title worth reading stop coexisting - roughly forty
// of metadata against sixty of prose.
const wideColumns = 100

// assumedColumns is the width used before the terminal has said what it is.
// Bubble Tea sends a size immediately, so this only ever covers the first
// frame and a test that never sends one.
const assumedColumns = 120

// minimumWork is the narrowest title preview worth drawing. Below it the
// preview is nearly all ellipsis, and the row is better off without it - the
// title is in the detail block whole.
const minimumWork = 12

const (
	keys       = "j/k select  enter attach  r refresh  q quit"
	narrowKeys = "j/k enter r q"
)

// View draws the header, the rows, the selected work item and the footer.
func (m Model) View() string {
	var lines []string
	lines = append(lines, m.header()...)
	lines = append(lines, "")
	lines = append(lines, m.body()...)
	lines = append(lines, m.detail()...)
	lines = append(lines, m.footer()...)
	var out strings.Builder
	for _, line := range lines {
		out.WriteString(m.fit(line) + "\n")
	}
	return out.String()
}

// columns is the width the layout is decided at.
func (m Model) columns() int {
	if m.width <= 0 {
		return assumedColumns
	}
	return m.width
}

func (m Model) wide() bool { return m.columns() >= wideColumns }

func (m Model) title() string { return "quarterdeck / " + m.label }

// header is the fleet, what it is doing, and how old the picture is.
//
// Two lines when they fit: the fleet and its size against the snapshot's age,
// then what the workers are doing against what Enter can reach. When they do
// not fit, the same facts collapse to the three numbers that change a
// decision - how many are active, how many can be opened, and how old this is.
func (m Model) header() []string {
	switch {
	case !m.loaded:
		return []string{m.title() + " - reading the fleet"}
	case m.loadErr != "":
		return []string{m.title() + " - the fleet could not be read"}
	}
	width := m.columns()
	first, firstFits := pair(m.title()+gap+m.active(), m.snapshotAge(), width)
	// An empty fleet has no states and no runs to count, and the age is the
	// one fact left that matters: it says whether nothing is happening or
	// whether nothing has been read lately.
	if len(m.items) == 0 {
		if firstFits {
			return []string{first}
		}
		return []string{m.title(), m.active() + " | " + m.compactAge()}
	}
	second, secondFits := pair(m.stateCounts(), "run access: "+m.runCounts(), width)
	if firstFits && secondFits {
		return []string{first, second}
	}
	return []string{m.title(), strings.Join(m.compactCounts(), " | ")}
}

func (m Model) active() string { return strconv.Itoa(len(m.items)) + " active" }

// stateCounts folds the list into its operational states, in the vocabulary's
// own order so the summary reads the same way on every refresh.
func (m Model) stateCounts() string {
	counted := map[string]int{}
	for _, item := range m.items {
		counted[stateLabel(item.State)]++
	}
	var parts []string
	for _, label := range stateLabels() {
		if counted[label] > 0 {
			parts = append(parts, strconv.Itoa(counted[label])+" "+label)
		}
	}
	return strings.Join(parts, " | ")
}

// runCounts is the same fold over what Enter can reach.
//
// `ready` is drawn even when it is zero, because zero is the answer that
// changes what the operator does next; every other kind appears only when the
// fleet actually has one.
func (m Model) runCounts() string {
	counted := m.availability()
	var parts []string
	for _, kind := range nomistakes.Order {
		if counted[kind] == 0 && kind != nomistakes.Ready {
			continue
		}
		parts = append(parts, strconv.Itoa(counted[kind])+" "+kind.Label())
	}
	return strings.Join(parts, " | ")
}

func (m Model) availability() map[nomistakes.Availability]int {
	counted := map[nomistakes.Availability]int{}
	for _, item := range m.items {
		counted[runKind(item)]++
	}
	return counted
}

// runKind is what Enter will do on one row.
//
// Attachable is the authority, not the kind the lookup wrote down: the two
// agree everywhere a lookup produced them, and where they could not - a value
// assembled by hand - the label must follow the key rather than the note
// beside it.
func runKind(item Item) nomistakes.Availability {
	if item.Attachable() {
		return nomistakes.Ready
	}
	return item.Attach.Kind
}

func (m Model) compactCounts() []string {
	return []string{
		m.active(),
		strconv.Itoa(m.availability()[nomistakes.Ready]) + " " + nomistakes.Ready.Label(),
		m.compactAge(),
	}
}

func (m Model) body() []string {
	if m.loadErr != "" {
		return []string{m.loadErr, ""}
	}
	if !m.loaded {
		return nil
	}
	if len(m.items) == 0 {
		return []string{"Nothing is in progress. Nothing is wrong.", ""}
	}
	table := m.table()
	if m.wide() {
		return append(m.wideRows(table), "")
	}
	return append(m.narrowRows(table), "")
}

// table is the width of every fixed column, measured over the list rather than
// written down, so a fleet of short states does not pay for a long one.
type table struct {
	number  int
	state   int
	run     int
	project int
}

func (m Model) table() table {
	sized := table{
		number:  widthOf(strconv.Itoa(len(m.items))),
		state:   widthOf(stateHead),
		run:     widthOf(runHead),
		project: widthOf(projectHead),
	}
	for _, item := range m.items {
		sized.state = max(sized.state, widthOf(stateLabel(item.State)))
		sized.run = max(sized.run, widthOf(runKind(item).Label()))
		sized.project = max(sized.project, widthOf(item.Project))
	}
	return sized
}

const (
	numberHead  = "#"
	stateHead   = "STATE"
	runHead     = "RUN"
	projectHead = "PROJECT"
	workHead    = "WORK"
)

// wideRows is the one-line table: a heading, then one line per work item with
// every column at a fixed offset.
func (m Model) wideRows(sized table) []string {
	prefix := 2 + sized.number
	used := prefix + widthOf(gap) + sized.state + widthOf(gap) + sized.run + widthOf(gap) + sized.project + widthOf(gap)
	work := m.columns() - used
	head := m.mark(cursorAway, rightAlign(numberHead, sized.number)) + gap +
		pad(stateHead, sized.state) + gap + pad(runHead, sized.run) + gap +
		pad(projectHead, sized.project)
	if work >= minimumWork {
		head += gap + workHead
	}
	lines := []string{head}
	for i, item := range m.items {
		line := m.mark(m.marker(i), rightAlign(strconv.Itoa(i+1), sized.number)) + gap +
			pad(stateLabel(item.State), sized.state) + gap +
			pad(runKind(item).Label(), sized.run) + gap +
			pad(item.Project, sized.project)
		if work >= minimumWork {
			line += gap + elide(item.Title, work)
		}
		lines = append(lines, strings.TrimRight(line, " "))
	}
	return lines
}

// narrowRows keeps the comparison on line one and moves the title to line two.
//
// The order is the priority order: the marker, where the operator is in the
// list, what the worker is doing, and whether Enter opens it. Project is
// dropped from the line before any of those is, and the title preview is
// dropped before project - both of them are in the detail block whole.
func (m Model) narrowRows(sized table) []string {
	places := widthOf(m.place(len(m.items) - 1))
	// The title falls under the state column rather than under the marker, so
	// line two reads as this row's continuation and not as a row of its own.
	indent := strings.Repeat(" ", 2+places+widthOf(gap))
	var lines []string
	for i, item := range m.items {
		line := m.mark(m.marker(i), pad(m.place(i), places)) + gap +
			pad(stateLabel(item.State), sized.state) + gap +
			pad(runKind(item).Label(), sized.run)
		if withProject := line + gap + item.Project; widthOf(withProject) <= m.columns() {
			line = withProject
		}
		lines = append(lines, strings.TrimRight(line, " "))
		if work := m.columns() - widthOf(indent); work >= minimumWork {
			lines = append(lines, indent+elide(item.Title, work))
		}
	}
	return lines
}

// place is where one row sits in the list, which replaces the number column
// when there is no room for a heading to explain it.
func (m Model) place(index int) string {
	return strconv.Itoa(index+1) + "/" + strconv.Itoa(len(m.items))
}

func (m Model) marker(index int) string {
	if index == m.cursor {
		return cursorHere
	}
	return cursorAway
}

// mark is the selection column: the marker, a gap wide enough that it is not
// read as part of the number, and the number itself.
func (m Model) mark(marker, number string) string {
	return marker + " " + number
}

func (m Model) footer() []string {
	help := keys
	if widthOf(help) > m.columns() {
		help = narrowKeys
	}
	if m.childErr != "" {
		return append(wrap("no-mistakes exited badly: "+m.childErr, m.columns()), help)
	}
	return []string{help}
}

// fit is the last resort, and it is only ever a resort: every line above is
// built to the width already, and wrapped prose is wrapped rather than cut.
func (m Model) fit(text string) string {
	if m.width <= 0 || widthOf(text) <= m.width {
		return text
	}
	return elide(text, m.width)
}
