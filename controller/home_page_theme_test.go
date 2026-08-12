package controller

import (
	"archive/zip"
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestImportHomePageThemeRejectsNoFile(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	require.NoError(t, writer.WriteField("name", "demo"))
	require.NoError(t, writer.Close())

	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/home-page-theme/", &body)
	context.Request.Header.Set("Content-Type", writer.FormDataContentType())

	ImportHomePageTheme(context)

	assert.Equal(t, http.StatusOK, response.Code)
	var payload struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	assert.False(t, payload.Success)
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

func TestHomePageThemeContentValues(t *testing.T) {
	themes := []HomePageTheme{
		{ID: "t1", Name: "one", Content: "<h1>home</h1>", About: "<p>about</p>"},
	}

	t.Run("default clears all pages", func(t *testing.T) {
		values := homePageThemeContentValues(themes, defaultHomePageThemeID, HomePageManual{})
		assert.Equal(t, "", values[homePageContentOptionKey])
		assert.Equal(t, "", values[aboutOptionKey])
		assert.Equal(t, "", values[legalUserAgreementOptionKey])
		assert.Equal(t, "", values[legalPrivacyPolicyOptionKey])
	})

	t.Run("manual applies manual content", func(t *testing.T) {
		manual := HomePageManual{Home: "mh", About: "ma", UserAgreement: "mu", PrivacyPolicy: "mp"}
		values := homePageThemeContentValues(themes, manualHomePageThemeID, manual)
		assert.Equal(t, "mh", values[homePageContentOptionKey])
		assert.Equal(t, "ma", values[aboutOptionKey])
		assert.Equal(t, "mu", values[legalUserAgreementOptionKey])
		assert.Equal(t, "mp", values[legalPrivacyPolicyOptionKey])
	})

	t.Run("imported theme maps fields, missing cleared", func(t *testing.T) {
		values := homePageThemeContentValues(themes, "t1", HomePageManual{})
		assert.Equal(t, "<h1>home</h1>", values[homePageContentOptionKey])
		assert.Equal(t, "<p>about</p>", values[aboutOptionKey])
		assert.Equal(t, "", values[legalUserAgreementOptionKey])
		assert.Equal(t, "", values[legalPrivacyPolicyOptionKey])
	})

	t.Run("unknown id clears all pages", func(t *testing.T) {
		values := homePageThemeContentValues(themes, "missing", HomePageManual{})
		assert.Equal(t, "", values[homePageContentOptionKey])
		assert.Equal(t, "", values[aboutOptionKey])
	})
}

func TestHomePageThemePages(t *testing.T) {
	theme := HomePageTheme{Content: "h", PrivacyPolicy: "p"}
	assert.Equal(t, []string{"home", "privacy_policy"}, homePageThemePages(&theme))
	assert.Empty(t, homePageThemePages(&HomePageTheme{}))
}

func TestParseThemeZip(t *testing.T) {
	makeZip := func(files map[string]string) []byte {
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		for name, content := range files {
			w, err := zw.Create(name)
			if err != nil {
				panic(err)
			}
			_, _ = w.Write([]byte(content))
		}
		_ = zw.Close()
		return buf.Bytes()
	}

	t.Run("valid zip extracts pages", func(t *testing.T) {
		manual, _, _, err := parseThemeZip(makeZip(map[string]string{
			"home.html":      "<h1>home</h1>",
			"about.html":     "<p>about</p>",
			"agreement.html": "<p>agreement</p>",
			"privacy.html":   "<p>privacy</p>",
		}))
		require.NoError(t, err)
		assert.Equal(t, "<h1>home</h1>", manual.Home)
		assert.Equal(t, "<p>about</p>", manual.About)
		assert.Equal(t, "<p>agreement</p>", manual.UserAgreement)
		assert.Equal(t, "<p>privacy</p>", manual.PrivacyPolicy)
	})

	t.Run("ignores macos/ds_store/other files", func(t *testing.T) {
		manual, _, _, err := parseThemeZip(makeZip(map[string]string{
			"home.html":            "<h1>home</h1>",
			"__MACOSX/home.html":   "junk",
			".DS_Store":            "junk",
			"readme.md":            "docs",
			"home.txt":             "txt",
		}))
		require.NoError(t, err)
		assert.Equal(t, "<h1>home</h1>", manual.Home)
		assert.Equal(t, "", manual.About)
	})

	t.Run("extracts preview image", func(t *testing.T) {
		_, preview, _, err := parseThemeZip(makeZip(map[string]string{
			"home.html":   "<h1>home</h1>",
			"preview.png": "fake-image-bytes",
		}))
		require.NoError(t, err)
		assert.Equal(t, "data:image/png;base64,ZmFrZS1pbWFnZS1ieXRlcw==", preview)
	})

	t.Run("extracts version file", func(t *testing.T) {
		_, _, version, err := parseThemeZip(makeZip(map[string]string{
			"home.html":   "<h1>home</h1>",
			"version.txt": "1.2.0",
		}))
		require.NoError(t, err)
		assert.Equal(t, "1.2.0", version)
	})

	t.Run("oversized version rejected", func(t *testing.T) {
		_, _, _, err := parseThemeZip(makeZip(map[string]string{
			"home.html":   "<h1>home</h1>",
			"version.txt": strings.Repeat("v", maxThemeVersionLen+1),
		}))
		require.Error(t, err)
	})

	t.Run("missing home rejected", func(t *testing.T) {
		_, _, _, err := parseThemeZip(makeZip(map[string]string{"about.html": "<p>about</p>"}))
		require.Error(t, err)
	})

	t.Run("zip slip rejected", func(t *testing.T) {
		_, _, _, err := parseThemeZip(makeZip(map[string]string{
			"home.html":     "<h1>home</h1>",
			"../evil.html":  "evil",
		}))
		require.Error(t, err)
	})

	t.Run("oversized file rejected", func(t *testing.T) {
		_, _, _, err := parseThemeZip(makeZip(map[string]string{
			"home.html": strings.Repeat("a", maxHomePageThemeContentLen+1),
		}))
		require.Error(t, err)
	})

	t.Run("not a zip rejected", func(t *testing.T) {
		_, _, _, err := parseThemeZip([]byte("not a zip"))
		require.Error(t, err)
	})
}

func TestHomePageThemeJSONRoundTrip(t *testing.T) {
	themes := []HomePageTheme{
		{ID: "t1", Name: "demo", Content: "<!doctype html><html><body>hi</body></html>", About: "a", CreatedAt: 1700000000},
	}
	raw, err := common.Marshal(themes)
	require.NoError(t, err)

	var parsed []HomePageTheme
	require.NoError(t, common.UnmarshalJsonStr(string(raw), &parsed))
	require.Len(t, parsed, 1)
	assert.Equal(t, themes[0].ID, parsed[0].ID)
	assert.Equal(t, themes[0].Name, parsed[0].Name)
	assert.Equal(t, themes[0].Content, parsed[0].Content)
	assert.Equal(t, themes[0].About, parsed[0].About)
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
