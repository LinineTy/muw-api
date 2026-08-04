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
		want  []LinuxDOBlacklistEntry
	}{
		{name: "empty", value: "", want: nil},
		{
			name:  "legacy newline separated with blank lines",
			value: " 123 \nfoo\n\nbar\n",
			want: []LinuxDOBlacklistEntry{
				{Type: "both", Value: "123"},
				{Type: "both", Value: "foo"},
				{Type: "both", Value: "bar"},
			},
		},
		{
			name:  "legacy comma separated",
			value: "alice,bob",
			want: []LinuxDOBlacklistEntry{
				{Type: "both", Value: "alice"},
				{Type: "both", Value: "bob"},
			},
		},
		{
			name:  "legacy mixed separators",
			value: "alice, bob\ncharlie",
			want: []LinuxDOBlacklistEntry{
				{Type: "both", Value: "alice"},
				{Type: "both", Value: "bob"},
				{Type: "both", Value: "charlie"},
			},
		},
		{
			name:  "structured json keeps types",
			value: `[{"type":"id","value":"6"},{"type":"username","value":"Foo"}]`,
			want: []LinuxDOBlacklistEntry{
				{Type: "id", Value: "6"},
				{Type: "username", Value: "Foo"},
			},
		},
		{
			name:  "structured json unknown type falls back to both",
			value: `[{"type":"email","value":"a@b.c"}]`,
			want: []LinuxDOBlacklistEntry{
				{Type: "both", Value: "a@b.c"},
			},
		},
		{
			name:  "structured json trims and skips empty values",
			value: `[{"type":"id","value":"  "},{"type":"username","value":" foo "}]`,
			want: []LinuxDOBlacklistEntry{
				{Type: "username", Value: "foo"},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			SetLinuxDOBlacklist(tt.value)
			assert.Equal(t, tt.want, LinuxDOBlacklist)
		})
	}
}

func TestSerializeLinuxDOBlacklist(t *testing.T) {
	original := LinuxDOBlacklist
	t.Cleanup(func() { LinuxDOBlacklist = original })

	SetLinuxDOBlacklist(`[{"type":"id","value":"6"},{"type":"username","value":"foo"}]`)
	serialized := SerializeLinuxDOBlacklist()

	// Round-trips: feeding the serialized form back produces the same entries.
	var want []LinuxDOBlacklistEntry
	require.NoError(t, Unmarshal([]byte(serialized), &want))
	assert.Equal(t, LinuxDOBlacklist, want)

	// An empty blacklist serializes to an empty JSON array.
	SetLinuxDOBlacklist("")
	assert.Equal(t, "[]", SerializeLinuxDOBlacklist())
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

func TestIsLinuxDOBlacklistedDistinguishesIdAndUsername(t *testing.T) {
	original := LinuxDOBlacklist
	t.Cleanup(func() { LinuxDOBlacklist = original })

	// id=6 and a user whose username happens to be "6" are different people and
	// must not be conflated when each is blacklisted by its own type.
	SetLinuxDOBlacklist(`[{"type":"id","value":"6"},{"type":"username","value":"Other-User"}]`)

	tests := []struct {
		name     string
		id       int
		username string
		want     bool
	}{
		{name: "matching id blacklists regardless of username", id: 6, username: "6", want: true},
		{name: "username equal to a blacklisted id is not blacklisted", id: 7, username: "6", want: false},
		{name: "matching username blacklists regardless of id", id: 7, username: "other-user", want: true},
		{name: "id match wins even for an unrelated username", id: 6, username: "unrelated", want: true}, // id 6 is blacklisted
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, IsLinuxDOBlacklisted(tt.id, tt.username))
		})
	}
}
