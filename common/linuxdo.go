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
