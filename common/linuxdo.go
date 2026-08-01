package common

import (
	"strconv"
	"strings"
)

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

// SetLinuxDOBlacklist parses a raw blacklist text (newline or comma separated)
// into trimmed non-empty entries.
func SetLinuxDOBlacklist(value string) {
	LinuxDOBlacklist = nil
	for _, entry := range strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == '\n' || r == '\r'
	}) {
		if entry = strings.TrimSpace(entry); entry != "" {
			LinuxDOBlacklist = append(LinuxDOBlacklist, entry)
		}
	}
}

// IsLinuxDOBlacklisted reports whether the given LinuxDO id or username matches
// any entry in the blacklist. Matching is case-insensitive for usernames.
func IsLinuxDOBlacklisted(id int, username string) bool {
	idStr := strconv.Itoa(id)
	for _, entry := range LinuxDOBlacklist {
		if strings.EqualFold(entry, idStr) || strings.EqualFold(entry, username) {
			return true
		}
	}
	return false
}
