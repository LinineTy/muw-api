// @muw-owned
package oauth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

func TestPKCEFlowChallenge(t *testing.T) {
	flow := NewPKCEFlow()
	require.NotEmpty(t, flow.CodeVerifier)
	challenge := flow.Challenge()
	require.NotEmpty(t, challenge)
	// S256 challenge 不等于 verifier，且同一 verifier 总是推出同一 challenge
	assert.NotEqual(t, flow.CodeVerifier, challenge)
	assert.Equal(t, challenge, (&PKCEFlow{CodeVerifier: flow.CodeVerifier}).Challenge())
	// 没有流程时不带参数
	assert.Empty(t, (*PKCEFlow)(nil).Challenge())
	assert.Empty(t, (&PKCEFlow{}).Challenge())
}

func TestPKCESupportCoversOIDCAndGenericOnly(t *testing.T) {
	assert.True(t, SupportsPKCE(&OIDCProvider{}))
	assert.True(t, SupportsPKCE(&GenericOAuthProvider{}))
	assert.False(t, SupportsPKCE(&GitHubProvider{}))
}

func TestOIDCExchangeTokenSendsPKCEVerifier(t *testing.T) {
	gin.SetMode(gin.TestMode)
	settings := system_setting.GetOIDCSettings()
	original := *settings
	defer func() { *settings = original }()

	var gotVerifier string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, r.ParseForm())
		gotVerifier = r.PostFormValue("code_verifier")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "at", "token_type": "Bearer"})
	}))
	defer server.Close()

	settings.TokenEndpoint = server.URL
	settings.ClientId = "cid"
	settings.ClientSecret = "secret"

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/oauth/oidc?code=abc", nil)
	verifier := "verifier-value-abcdefghijklmnopqrstuvwxyz0123456789"
	WithPKCEVerifier(c, &PKCEFlow{CodeVerifier: verifier})

	provider := &OIDCProvider{}
	token, err := provider.ExchangeToken(c.Request.Context(), "abc", c)
	require.NoError(t, err)
	assert.Equal(t, "at", token.AccessToken)
	assert.Equal(t, verifier, gotVerifier)
}

func TestGenericExchangeTokenSendsPKCEVerifier(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var gotVerifier string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, r.ParseForm())
		gotVerifier = r.PostFormValue("code_verifier")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "at", "token_type": "Bearer"})
	}))
	defer server.Close()

	provider := &GenericOAuthProvider{config: &model.CustomOAuthProvider{
		Name:          "muw-api",
		Slug:          "muw-api",
		ClientId:      "cid",
		ClientSecret:  "secret",
		TokenEndpoint: server.URL,
		AuthStyle:     AuthStyleInParams,
	}}

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/oauth/muw-api?code=abc", nil)
	verifier := "verifier-value-abcdefghijklmnopqrstuvwxyz0123456789"
	WithPKCEVerifier(c, &PKCEFlow{CodeVerifier: verifier})

	token, err := provider.ExchangeToken(c.Request.Context(), "abc", c)
	require.NoError(t, err)
	assert.Equal(t, "at", token.AccessToken)
	assert.Equal(t, verifier, gotVerifier)
}
