package oauth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLinuxDOExchangeTokenParsesRefreshToken(t *testing.T) {
	common.LinuxDOClientId = "client-id"
	common.LinuxDOClientSecret = "client-secret"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "POST", r.Method)
		assert.Equal(t, "/oauth2/token", r.URL.Path)
		assert.NotEmpty(t, r.Header.Get("Authorization"))
		assert.Equal(t, "application/x-www-form-urlencoded", r.Header.Get("Content-Type"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"access-1","refresh_token":"refresh-1","expires_in":3600,"token_type":"bearer"}`))
	}))
	defer server.Close()

	t.Setenv("LINUX_DO_TOKEN_ENDPOINT", server.URL+"/oauth2/token")

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/oauth/linuxdo", nil)

	provider := &LinuxDOProvider{}
	token, err := provider.ExchangeToken(context.Background(), "some-code", c)
	require.NoError(t, err)
	assert.Equal(t, "access-1", token.AccessToken)
	assert.Equal(t, "refresh-1", token.RefreshToken)
	assert.Equal(t, 3600, token.ExpiresIn)
}

func TestLinuxDORefreshAccessTokenSuccess(t *testing.T) {
	common.LinuxDOClientId = "client-id"
	common.LinuxDOClientSecret = "client-secret"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		assert.Equal(t, "refresh_token", r.Form.Get("grant_type"))
		assert.Equal(t, "old-refresh", r.Form.Get("refresh_token"))
		assert.NotEmpty(t, r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"access-2","refresh_token":"refresh-2","expires_in":3600}`))
	}))
	defer server.Close()

	t.Setenv("LINUX_DO_TOKEN_ENDPOINT", server.URL+"/oauth2/token")

	provider := &LinuxDOProvider{}
	token, err := provider.RefreshAccessToken(context.Background(), "old-refresh")
	require.NoError(t, err)
	assert.Equal(t, "access-2", token.AccessToken)
	assert.Equal(t, "refresh-2", token.RefreshToken)
	assert.Equal(t, 3600, token.ExpiresIn)
}

func TestLinuxDORefreshAccessTokenInvalidGrant(t *testing.T) {
	common.LinuxDOClientId = "client-id"
	common.LinuxDOClientSecret = "client-secret"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"error":"invalid_grant","error_description":"The provided authorization grant is invalid"}`))
	}))
	defer server.Close()

	t.Setenv("LINUX_DO_TOKEN_ENDPOINT", server.URL+"/oauth2/token")

	provider := &LinuxDOProvider{}
	_, err := provider.RefreshAccessToken(context.Background(), "expired-refresh")
	require.ErrorIs(t, err, ErrLinuxDOTokenInvalid)
}

func TestLinuxDORefreshAccessTokenEmptyInput(t *testing.T) {
	provider := &LinuxDOProvider{}
	_, err := provider.RefreshAccessToken(context.Background(), "")
	require.ErrorIs(t, err, ErrLinuxDOTokenInvalid)
}

func TestLinuxDOGetUserInfoForRefreshSkipsTrustLevelGate(t *testing.T) {
	common.LinuxDOMinimumTrustLevel = 2

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer access-1", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		// trust_level 0 is below the configured minimum, but a refresh must still
		// surface it rather than denying the sync.
		_, _ = w.Write([]byte(`{"id":100,"username":"lin","name":"Lin","active":true,"trust_level":0}`))
	}))
	defer server.Close()

	t.Setenv("LINUX_DO_USER_ENDPOINT", server.URL+"/api/user")

	provider := &LinuxDOProvider{}
	user, err := provider.GetUserInfoForRefresh(context.Background(), &OAuthToken{AccessToken: "access-1"})
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, "100", user.ProviderUserID)
	trustLevel, ok := user.Extra["trust_level"].(int)
	require.True(t, ok)
	assert.Equal(t, 0, trustLevel)
}

func TestLinuxDOGetUserInfoStillEnforcesTrustLevelGate(t *testing.T) {
	common.LinuxDOMinimumTrustLevel = 2

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":100,"username":"lin","name":"Lin","active":true,"trust_level":1}`))
	}))
	defer server.Close()

	t.Setenv("LINUX_DO_USER_ENDPOINT", server.URL+"/api/user")

	provider := &LinuxDOProvider{}
	_, err := provider.GetUserInfo(context.Background(), &OAuthToken{AccessToken: "access-1"})
	var trustErr *TrustLevelError
	require.ErrorAs(t, err, &trustErr)
	assert.Equal(t, 2, trustErr.Required)
	assert.Equal(t, 1, trustErr.Current)
}

func TestLinuxDOGetUserInfoForRefreshDecodesProfile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":42,"username":"lin","name":"Lin Do","active":true,"trust_level":3,"silenced":false,"avatar_url":"https://x/a.png"}`))
	}))
	defer server.Close()

	t.Setenv("LINUX_DO_USER_ENDPOINT", server.URL+"/api/user")

	provider := &LinuxDOProvider{}
	user, err := provider.GetUserInfoForRefresh(context.Background(), &OAuthToken{AccessToken: "a"})
	require.NoError(t, err)
	assert.Equal(t, "lin", user.Username)
	assert.Equal(t, "Lin Do", user.DisplayName)

	payload, err := json.Marshal(user.Extra)
	require.NoError(t, err)
	assert.Contains(t, string(payload), "3")
}
