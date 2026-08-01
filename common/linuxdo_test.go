package common

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLinuxDOGroupForTrustLevel(t *testing.T) {
	// Preserve the global mapping and restore it after the test.
	original := LinuxDOGroupMapping
	t.Cleanup(func() { LinuxDOGroupMapping = original })

	require.NoError(t, UpdateLinuxDOGroupMappingByJSONString(`{"2":"vip","3":"svip"}`))

	tests := []struct {
		name       string
		trustLevel int
		want       string
	}{
		{name: "mapped level", trustLevel: 2, want: "vip"},
		{name: "another mapped level", trustLevel: 3, want: "svip"},
		{name: "unmapped level falls back to default", trustLevel: 1, want: "default"},
		{name: "level below any mapping falls back to default", trustLevel: 0, want: "default"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, LinuxDOGroupForTrustLevel(tt.trustLevel))
		})
	}

	// An empty mapping disables auto group assignment entirely.
	require.NoError(t, UpdateLinuxDOGroupMappingByJSONString(""))
	assert.Equal(t, "default", LinuxDOGroupForTrustLevel(4))
}

func TestSetLinuxDOBlacklist(t *testing.T) {
	original := LinuxDOBlacklist
	t.Cleanup(func() { LinuxDOBlacklist = original })

	tests := []struct {
		name  string
		value string
		want  []string
	}{
		{name: "empty", value: "", want: nil},
		{name: "newline separated with blank lines", value: " 123 \nfoo\n\nbar\n", want: []string{"123", "foo", "bar"}},
		{name: "comma separated", value: "alice,bob", want: []string{"alice", "bob"}},
		{name: "mixed separators", value: "alice, bob\ncharlie", want: []string{"alice", "bob", "charlie"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			SetLinuxDOBlacklist(tt.value)
			assert.Equal(t, tt.want, LinuxDOBlacklist)
		})
	}
}

func TestIsLinuxDOBlacklisted(t *testing.T) {
	original := LinuxDOBlacklist
	t.Cleanup(func() { LinuxDOBlacklist = original })

	SetLinuxDOBlacklist("12345\nsome-user\nFooBar")
	t.Cleanup(func() { LinuxDOBlacklist = original })

	tests := []struct {
		name     string
		id       int
		username string
		want     bool
	}{
		{name: "id matches", id: 12345, username: "nobody", want: true},
		{name: "username matches", id: 999, username: "some-user", want: true},
		{name: "username case-insensitive", id: 999, username: "foobar", want: true},
		{name: "neither matches", id: 777, username: "another", want: false},
		{name: "empty username", id: 999, username: "", want: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, IsLinuxDOBlacklisted(tt.id, tt.username))
		})
	}

	// An empty blacklist never blocks.
	SetLinuxDOBlacklist("")
	assert.False(t, IsLinuxDOBlacklisted(12345, "some-user"))
}
