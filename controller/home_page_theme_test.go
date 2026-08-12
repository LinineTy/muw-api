package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestImportHomePageThemeRejectsInvalidInput(t *testing.T) {
	tests := []struct {
		name    string
		payload string
	}{
		{name: "empty name", payload: `{"name":"","content":"<html></html>"}`},
		{name: "blank name", payload: `{"name":"   ","content":"<html></html>"}`},
		{name: "empty content", payload: `{"name":"demo","content":""}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			context.Request = httptest.NewRequest(
				http.MethodPost,
				"/api/home-page-theme/",
				strings.NewReader(tt.payload),
			)

			ImportHomePageTheme(context)

			assert.Equal(t, http.StatusOK, response.Code)
			var payload struct {
				Success bool   `json:"success"`
				Message string `json:"message"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
			assert.False(t, payload.Success)
			assert.NotEmpty(t, payload.Message)
		})
	}
}

func TestSelectHomePageThemeRejectsMissingID(t *testing.T) {
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/home-page-theme/select",
		strings.NewReader(`{"id":"missing-theme"}`),
	)

	SelectHomePageTheme(context)

	assert.Equal(t, http.StatusOK, response.Code)
	var payload struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	assert.False(t, payload.Success)
}

func TestValidateHomePageThemeName(t *testing.T) {
	tests := []struct {
		name string
		ok   bool
	}{
		{name: "my theme", ok: true},
		{name: strings.Repeat("a", 100), ok: true},
		{name: strings.Repeat("a", 101), ok: false},
		{name: "   ", ok: false},
		{name: "", ok: false},
		// 中文按字符数而非字节数计长:50 个汉字(150 字节)应通过。
		{name: strings.Repeat("主题", 50), ok: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateHomePageThemeName(tt.name)
			if tt.ok {
				assert.NoError(t, err)
			} else {
				assert.Error(t, err)
			}
		})
	}
}

func TestValidateHomePageThemeContent(t *testing.T) {
	tests := []struct {
		name    string
		content string
		ok      bool
	}{
		{name: "empty", content: "", ok: false},
		{name: "exactly limit", content: strings.Repeat("a", maxHomePageThemeContentLen), ok: true},
		{name: "one byte over limit", content: strings.Repeat("a", maxHomePageThemeContentLen+1), ok: false},
		{name: "small html", content: "<!doctype html><html><body>hi</body></html>", ok: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateHomePageThemeContent(tt.content)
			if tt.ok {
				assert.NoError(t, err)
			} else {
				assert.Error(t, err)
			}
		})
	}
}

func TestThemeContentFor(t *testing.T) {
	themes := []HomePageTheme{
		{ID: "t1", Name: "one", Content: "<p>one</p>"},
		{ID: "t2", Name: "two", Content: "<p>two</p>"},
	}
	tests := []struct {
		name     string
		selected string
		want     string
	}{
		{name: "default returns empty", selected: defaultHomePageThemeID, want: ""},
		{name: "selected theme returns content", selected: "t1", want: "<p>one</p>"},
		{name: "unknown id falls back to empty", selected: "missing", want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, themeContentFor(themes, tt.selected))
		})
	}
}

func TestHomePageThemeJSONRoundTrip(t *testing.T) {
	themes := []HomePageTheme{
		{ID: "t1", Name: "demo", Content: "<!doctype html><html><body>hi</body></html>", CreatedAt: 1700000000},
	}
	raw, err := common.Marshal(themes)
	require.NoError(t, err)

	var parsed []HomePageTheme
	require.NoError(t, common.UnmarshalJsonStr(string(raw), &parsed))
	require.Len(t, parsed, 1)
	assert.Equal(t, themes[0].ID, parsed[0].ID)
	assert.Equal(t, themes[0].Name, parsed[0].Name)
	assert.Equal(t, themes[0].Content, parsed[0].Content)
	assert.Equal(t, themes[0].CreatedAt, parsed[0].CreatedAt)
}

func TestFindHomePageTheme(t *testing.T) {
	themes := []HomePageTheme{
		{ID: "t1", Name: "one"},
		{ID: "t2", Name: "two"},
	}
	found, ok := findHomePageTheme(themes, "t2")
	require.True(t, ok)
	assert.Equal(t, "two", found.Name)

	_, ok = findHomePageTheme(themes, "missing")
	assert.False(t, ok)
}
