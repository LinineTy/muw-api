package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDecideCodingPlanAutoControl(t *testing.T) {
	cases := []struct {
		name        string
		status      int
		statusRason string
		utilization float64
		disable     int
		enable      int
		want        CodingPlanAutoControlAction
	}{
		{"enabled below threshold stays", common.ChannelStatusEnabled, "", 50, 98, 90, CodingPlanAutoControlNone},
		{"enabled at threshold disables", common.ChannelStatusEnabled, "", 98, 98, 90, CodingPlanAutoControlDisable},
		{"enabled above threshold disables", common.ChannelStatusEnabled, "", 99.5, 98, 90, CodingPlanAutoControlDisable},
		{"auto-disabled by us recovers below enable", common.ChannelStatusAutoDisabled, CodingPlanExhaustedReason, 89.9, 98, 90, CodingPlanAutoControlEnable},
		{"auto-disabled by us stays at or above enable", common.ChannelStatusAutoDisabled, CodingPlanExhaustedReason, 90, 98, 90, CodingPlanAutoControlNone},
		{"auto-disabled by relay not recovered", common.ChannelStatusAutoDisabled, "relay error", 10, 98, 90, CodingPlanAutoControlNone},
		{"manually disabled never touched", common.ChannelStatusManuallyDisabled, CodingPlanExhaustedReason, 10, 98, 90, CodingPlanAutoControlNone},
		{"untrusted utilization never acts", common.ChannelStatusEnabled, "", -1, 98, 90, CodingPlanAutoControlNone},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := decideCodingPlanAutoControl(tc.status, tc.statusRason, tc.utilization, tc.disable, tc.enable)
			assert.Equal(t, tc.want, got, "unexpected decision")
		})
	}
}

func TestCodingPlanEffectiveUtilization(t *testing.T) {
	failure := &dto.CodingPlanQuota{Success: false, Error: "boom"}
	assert.Equal(t, float64(-1), CodingPlanEffectiveUtilization(nil))
	assert.Equal(t, float64(-1), CodingPlanEffectiveUtilization(failure))

	cases := []struct {
		name  string
		quota *dto.CodingPlanQuota
		want  float64
	}{
		{"empty tiers", &dto.CodingPlanQuota{Success: true}, 0},
		{"max of tiers", &dto.CodingPlanQuota{Success: true, Tiers: []dto.CodingPlanTier{
			{Name: CodingPlanTierFiveHour, Utilization: 12.5},
			{Name: CodingPlanTierWeeklyLimit, Utilization: 97.8},
		}}, 97.8},
		{"negative clamped to zero", &dto.CodingPlanQuota{Success: true, Tiers: []dto.CodingPlanTier{
			{Name: CodingPlanTierFiveHour, Utilization: -5},
		}}, 0},
		{"over 100 clamped", &dto.CodingPlanQuota{Success: true, Tiers: []dto.CodingPlanTier{
			{Name: CodingPlanTierFiveHour, Utilization: 150},
		}}, 100},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, CodingPlanEffectiveUtilization(tc.quota))
		})
	}
}

func TestCodingPlanAutoControlThresholds(t *testing.T) {
	intPtr := func(v int) *int { return &v }

	cases := []struct {
		name      string
		channel   *model.Channel
		wantDis   int
		wantEn    int
	}{
		{"nil channel uses defaults", nil, 98, 90},
		{"nil fields use defaults", &model.Channel{}, 98, 90},
		{"custom thresholds honored", &model.Channel{
			CodingPlanDisableThreshold: intPtr(95),
			CodingPlanEnableThreshold:  intPtr(85),
		}, 95, 85},
		{"out-of-range disable falls back", &model.Channel{CodingPlanDisableThreshold: intPtr(150)}, 98, 90},
		{"zero disable falls back", &model.Channel{CodingPlanDisableThreshold: intPtr(0)}, 98, 90},
		{"enable above disable falls back", &model.Channel{CodingPlanDisableThreshold: intPtr(98), CodingPlanEnableThreshold: intPtr(99)}, 98, 90},
		{"enable clamped below disable", &model.Channel{CodingPlanDisableThreshold: intPtr(50)}, 50, 49},
		{"zero enable allowed", &model.Channel{CodingPlanDisableThreshold: intPtr(98), CodingPlanEnableThreshold: intPtr(0)}, 98, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dis, en := CodingPlanAutoControlThresholds(tc.channel)
			require.Equal(t, tc.wantDis, dis)
			require.Equal(t, tc.wantEn, en)
			assert.Less(t, en, dis, "enable threshold must stay strictly below disable")
		})
	}
}
