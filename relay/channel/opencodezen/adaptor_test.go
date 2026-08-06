package opencodezen

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/assert"
)

func TestResolveApiKey(t *testing.T) {
	tests := []struct {
		name string
		key  string
		want string
	}{
		{name: "empty key uses the anonymous free sentinel", key: "", want: PublicApiKey},
		{name: "blank key uses the anonymous free sentinel", key: "  ", want: PublicApiKey},
		{name: "filled key is passed through for the paid plan", key: "oc_zen_secret", want: "oc_zen_secret"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{
				ChannelMeta: &relaycommon.ChannelMeta{ApiKey: tt.key},
			}

			assert.Equal(t, tt.want, resolveApiKey(info))
		})
	}
}
