package common

import (
	"strconv"
	"strings"
)

// LinuxDOBlacklistEntry is one entry in the LinuxDO blacklist. Type is "id"
// (exact match on the numeric account id), "username" (case-insensitive match on
// the account name) or "both" (legacy: matches either), and Value is the pattern
// to match. Carrying the type explicitly keeps a numeric id and a username that
// happen to be identical (e.g. both "6") distinguishable.
type LinuxDOBlacklistEntry struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

// UpdateLinuxDOGroupMappingByJSONString replaces the LinuxDO trust-level → group
// mapping from its JSON form (e.g. `{"2":"vip","3":"svip"}`). An empty string
// clears the mapping and disables auto group assignment.
func UpdateLinuxDOGroupMappingByJSONString(jsonStr string) error {
	LinuxDOGroupMapping = make(map[string]string)
	jsonStr = strings.TrimSpace(jsonStr)
	if jsonStr == "" {
		return nil
	}
	return Unmarshal([]byte(jsonStr), &LinuxDOGroupMapping)
}

// LinuxDOGroupForTrustLevel returns the group assigned to a LinuxDO trust
// level, falling back to the configured default group when the level is
// unmapped.
func LinuxDOGroupForTrustLevel(trustLevel int) string {
	group, ok := LinuxDOGroupMapping[strconv.Itoa(trustLevel)]
	if !ok || group == "" {
		return DefaultUserGroup
	}
	return group
}

// SetLinuxDOBlacklist parses a blacklist from its JSON array form
// (`[{"type":"id","value":"6"},{"type":"username","value":"foo"}]`). A value
// that is not a JSON array is parsed as legacy newline/comma separated text,
// where every entry matches either the id or the username, preserving the old
// behavior for existing configurations.
func SetLinuxDOBlacklist(value string) {
	LinuxDOBlacklist = nil
	value = strings.TrimSpace(value)
	if value == "" {
		return
	}

	var entries []LinuxDOBlacklistEntry
	if Unmarshal([]byte(value), &entries) == nil {
		for _, entry := range entries {
			entry.Type = strings.ToLower(strings.TrimSpace(entry.Type))
			entry.Value = strings.TrimSpace(entry.Value)
			if entry.Value == "" {
				continue
			}
			if entry.Type != "id" && entry.Type != "username" {
				entry.Type = "both"
			}
			LinuxDOBlacklist = append(LinuxDOBlacklist, entry)
		}
		return
	}

	for _, entry := range strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == '\n' || r == '\r'
	}) {
		if entry = strings.TrimSpace(entry); entry != "" {
			LinuxDOBlacklist = append(LinuxDOBlacklist, LinuxDOBlacklistEntry{Type: "both", Value: entry})
		}
	}
}

// SerializeLinuxDOBlacklist returns the blacklist in its JSON array form so the
// settings UI can render it back as structured rows. A nil (empty) blacklist
// serializes to an empty JSON array rather than null.
func SerializeLinuxDOBlacklist() string {
	if LinuxDOBlacklist == nil {
		return "[]"
	}
	data, err := Marshal(LinuxDOBlacklist)
	if err != nil {
		return "[]"
	}
	return string(data)
}

// IsLinuxDOBlacklisted reports whether the given LinuxDO id or username matches
// any blacklist entry. "id" entries match the numeric id exactly, "username"
// entries match the username case-insensitively, and legacy "both" entries match
// either.
func IsLinuxDOBlacklisted(id int, username string) bool {
	idStr := strconv.Itoa(id)
	for _, entry := range LinuxDOBlacklist {
		switch entry.Type {
		case "id":
			if entry.Value == idStr {
				return true
			}
		case "username":
			if strings.EqualFold(entry.Value, username) {
				return true
			}
		default: // "both" (legacy)
			if strings.EqualFold(entry.Value, idStr) || strings.EqualFold(entry.Value, username) {
				return true
			}
		}
	}
	return false
}
