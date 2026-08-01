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
