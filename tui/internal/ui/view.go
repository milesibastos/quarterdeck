package ui

import (
	"strconv"
	"strings"
)

// The list is drawn in text and nothing else: no colour, no box drawing, no
// second face. It sits in front of no-mistakes' own screen and hands the
// terminal to it whole, so anything it painted would be a second grammar
// competing with the one the operator actually came for.
const (
	cursorHere = "> "
	cursorAway = "  "
	// unavailable marks a row Enter does nothing on, and is followed by the
	// reason. A row is never hidden for being unopenable.
	unavailable = "-- "
	openable    = "attach"
)

const keys = "up/down or j/k move - enter opens no-mistakes - r refreshes - q quits"

// View draws the header, the rows and the footer.
func (m Model) View() string {
	var out strings.Builder
	out.WriteString(m.truncate(m.header()) + "\n\n")
	out.WriteString(m.body())
	out.WriteString("\n" + m.footer() + "\n")
	return out.String()
}

func (m Model) header() string {
	head := "quarterdeck - " + m.label
	switch {
	case !m.loaded:
		return head + " - reading the fleet"
	case m.loadErr != "":
		return head + " - the fleet could not be read"
	}
	return head + " - " + plural(len(m.items), "work item") + " in progress"
}

func (m Model) body() string {
	if m.loadErr != "" {
		return m.truncate(m.loadErr) + "\n"
	}
	if !m.loaded {
		return ""
	}
	if len(m.items) == 0 {
		return m.truncate("Nothing is in progress. Nothing is wrong.") + "\n"
	}
	var out strings.Builder
	for i, item := range m.items {
		out.WriteString(m.line(i, item) + "\n")
	}
	return out.String()
}

func (m Model) line(index int, item Item) string {
	marker := cursorAway
	if index == m.cursor {
		marker = cursorHere
	}
	action := openable
	if !item.Attachable() {
		action = unavailable + item.Attach.Why
	}
	fields := []string{
		item.Title,
		item.Project,
		item.State,
		action,
	}
	return m.truncate(marker + strings.Join(fields, "  -  "))
}

func (m Model) footer() string {
	if m.childErr != "" {
		return m.truncate("no-mistakes exited badly: "+m.childErr) + "\n" + m.truncate(keys)
	}
	return m.truncate(keys)
}

func (m Model) truncate(text string) string {
	if m.width <= 0 {
		return text
	}
	runes := []rune(text)
	if len(runes) <= m.width {
		return text
	}
	if m.width <= 1 {
		return string(runes[:m.width])
	}
	return string(runes[:m.width-1]) + "…"
}

func plural(count int, noun string) string {
	if count == 1 {
		return "1 " + noun
	}
	return strconv.Itoa(count) + " " + noun + "s"
}
