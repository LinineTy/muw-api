package common

import "strings"

// User preference keys (must match the frontend preference UI and dto.UserSetting).
const (
	PreferenceKeyAcceptUnsetModelRatioModel = "accept_unset_model_ratio_model"
	PreferenceKeyRecordIpLog                = "record_ip_log"
	PreferenceKeyUpstreamModelUpdateNotify  = "upstream_model_update_notify_enabled"
)

// UserPreferencePolicy is the global admin policy for the profile preference
// switches. ForceOn preferences are always enabled for every user and users
// cannot turn them off; Locked preferences keep their current value and users
// cannot change them at all.
type UserPreferencePolicy struct {
	ForceOn []string `json:"force_on"`
	Locked  []string `json:"locked"`
}

// userPreferencePolicy holds the active policy. An empty config allows users to
// control every preference freely.
var userPreferencePolicy = UserPreferencePolicy{}

// UserPreferencePolicy2JSONString serializes the policy for the option system.
func UserPreferencePolicy2JSONString() string {
	jsonBytes, err := Marshal(userPreferencePolicy)
	if err != nil {
		SysError("error marshalling user preference policy: " + err.Error())
		return "{}"
	}
	return string(jsonBytes)
}

// UpdateUserPreferencePolicyByJSONString replaces the policy from its JSON
// form, e.g. `{"force_on":["record_ip_log"],"locked":["accept_unset_model_ratio_model"]}`.
// An empty string resets the policy.
func UpdateUserPreferencePolicyByJSONString(jsonStr string) error {
	userPreferencePolicy = UserPreferencePolicy{}
	jsonStr = strings.TrimSpace(jsonStr)
	if jsonStr == "" {
		return nil
	}
	return Unmarshal([]byte(jsonStr), &userPreferencePolicy)
}

// GetUserPreferencePolicy returns a copy of the active policy.
func GetUserPreferencePolicy() UserPreferencePolicy {
	return userPreferencePolicy
}

// PreferenceForceOn reports whether the preference is force-enabled.
func PreferenceForceOn(key string) bool {
	return containsPreference(userPreferencePolicy.ForceOn, key)
}

// PreferenceLocked reports whether the preference is locked from user changes.
func PreferenceLocked(key string) bool {
	return containsPreference(userPreferencePolicy.Locked, key)
}

func containsPreference(list []string, key string) bool {
	for _, k := range list {
		if k == key {
			return true
		}
	}
	return false
}
