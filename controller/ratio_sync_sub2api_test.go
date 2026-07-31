package controller

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConvertSub2APIToRatioData(t *testing.T) {
	const plazaJSON = `{
  "code": 0,
  "message": "success",
  "data": {
    "description": "test plaza",
    "groups": [
      {
        "id": 1,
        "name": "default",
        "rate_multiplier": 1.0,
        "is_exclusive": false,
        "peak_rate_enabled": false,
        "peak_rate_multiplier": 0,
        "models": [
          {
            "name": "gpt-4o",
            "platform": "openai",
            "official_pricing": {
              "input_price": 0.0000025,
              "output_price": 0.00001,
              "cache_read_price": 0.00000125
            }
          },
          {
            "name": "claude-3-5-sonnet",
            "platform": "anthropic",
            "official_pricing": {
              "input_price": 0.000003,
              "output_price": 0.000015
            }
          }
        ]
      }
    ]
  }
}`

	data, err := convertSub2APIToRatioData(strings.NewReader(plazaJSON))
	require.NoError(t, err)

	modelRatio, ok := data["model_ratio"].(map[string]any)
	require.True(t, ok, "expected model_ratio map")

	// model_ratio = input_price * 1000 * USD(500) * multiplier(1.0)
	assert.Equal(t, 1.25, modelRatio["gpt-4o"])
	assert.Equal(t, 1.5, modelRatio["claude-3-5-sonnet"])

	completionRatio, ok := data["completion_ratio"].(map[string]any)
	require.True(t, ok, "expected completion_ratio map")
	assert.Equal(t, 4.0, completionRatio["gpt-4o"])   // 0.00001 / 0.0000025
	assert.Equal(t, 5.0, completionRatio["claude-3-5-sonnet"]) // 0.000015 / 0.000003

	cacheRatio, ok := data["cache_ratio"].(map[string]any)
	require.True(t, ok, "expected cache_ratio map")
	assert.Equal(t, 0.5, cacheRatio["gpt-4o"]) // 0.00000125 / 0.0000025
	// claude-3-5-sonnet has no cache_read_price -> excluded from cache_ratio
	_, hasCache := cacheRatio["claude-3-5-sonnet"]
	assert.False(t, hasCache)
}

func TestConvertSub2APIToRatioDataMultiplier(t *testing.T) {
	const plazaJSON = `{
  "code": 0,
  "message": "success",
  "data": {
    "groups": [
      {
        "id": 1,
        "name": "priority",
        "rate_multiplier": 2.0,
        "is_exclusive": false,
        "models": [
          {
            "name": "gpt-4o",
            "official_pricing": { "input_price": 0.0000025, "output_price": 0.00001 }
          }
        ]
      }
    ]
  }
}`

	data, err := convertSub2APIToRatioData(strings.NewReader(plazaJSON))
	require.NoError(t, err)

	modelRatio := data["model_ratio"].(map[string]any)
	// 0.0000025 * 500000 * 2.0
	assert.Equal(t, 2.5, modelRatio["gpt-4o"])
}

func TestConvertSub2APIToRatioDataPicksMinimumMultiplier(t *testing.T) {
	const plazaJSON = `{
  "code": 0,
  "message": "success",
  "data": {
    "groups": [
      {
        "id": 1,
        "name": "priority",
        "rate_multiplier": 1.5,
        "is_exclusive": false,
        "models": [
          { "name": "gpt-4o", "official_pricing": { "input_price": 0.0000025, "output_price": 0.00001 } }
        ]
      },
      {
        "id": 2,
        "name": "flex",
        "rate_multiplier": 1.0,
        "is_exclusive": false,
        "models": [
          { "name": "gpt-4o", "official_pricing": { "input_price": 0.0000025, "output_price": 0.00001 } }
        ]
      }
    ]
  }
}`

	data, err := convertSub2APIToRatioData(strings.NewReader(plazaJSON))
	require.NoError(t, err)

	modelRatio := data["model_ratio"].(map[string]any)
	// 取最小倍率 1.0
	assert.Equal(t, 1.25, modelRatio["gpt-4o"])
}

func TestConvertSub2APIToRatioDataExcludesExclusiveGroups(t *testing.T) {
	const plazaJSON = `{
  "code": 0,
  "message": "success",
  "data": {
    "groups": [
      {
        "id": 1,
        "name": "default",
        "rate_multiplier": 1.0,
        "is_exclusive": false,
        "models": [
          { "name": "gpt-4o", "official_pricing": { "input_price": 0.0000025, "output_price": 0.00001 } }
        ]
      },
      {
        "id": 2,
        "name": "vip",
        "rate_multiplier": 0.1,
        "is_exclusive": true,
        "models": [
          { "name": "gpt-4o", "official_pricing": { "input_price": 0.0000025, "output_price": 0.00001 } }
        ]
      }
    ]
  }
}`

	data, err := convertSub2APIToRatioData(strings.NewReader(plazaJSON))
	require.NoError(t, err)

	modelRatio := data["model_ratio"].(map[string]any)
	// 专属分组被忽略，仍使用非专属分组倍率 1.0
	assert.Equal(t, 1.25, modelRatio["gpt-4o"])
}

func TestConvertSub2APIToRatioDataErrors(t *testing.T) {
	t.Run("non-zero envelope code", func(t *testing.T) {
		_, err := convertSub2APIToRatioData(strings.NewReader(`{"code":404,"message":"not found","data":{}}`))
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not found")
	})

	t.Run("no valid pricing entries", func(t *testing.T) {
		const plazaJSON = `{
          "code": 0,
          "message": "success",
          "data": { "groups": [ { "id": 1, "rate_multiplier": 1.0, "is_exclusive": false, "models": [
            { "name": "gpt-4o", "official_pricing": { "input_price": 0 } }
          ] } ] }
        }`
		_, err := convertSub2APIToRatioData(strings.NewReader(plazaJSON))
		require.Error(t, err)
		assert.Contains(t, err.Error(), "no valid")
	})

	t.Run("malformed json", func(t *testing.T) {
		_, err := convertSub2APIToRatioData(strings.NewReader(`not json`))
		require.Error(t, err)
	})
}
