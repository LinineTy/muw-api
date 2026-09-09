package oauth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func init() {
	Register("linuxdo", &LinuxDOProvider{})
}

// LinuxDOProvider implements OAuth for Linux DO
type LinuxDOProvider struct{}

type linuxdoUser struct {
	Id         int    `json:"id"`
	Username   string `json:"username"`
	Name       string `json:"name"`
	Active     bool   `json:"active"`
	TrustLevel int    `json:"trust_level"`
	Silenced   bool   `json:"silenced"`
	AvatarURL  string `json:"avatar_url"`
}

func (p *LinuxDOProvider) GetName() string {
	return "Linux DO"
}

func (p *LinuxDOProvider) IsEnabled() bool {
	return common.LinuxDOOAuthEnabled
}

func (p *LinuxDOProvider) ExchangeToken(ctx context.Context, code string, c *gin.Context) (*OAuthToken, error) {
	if code == "" {
		return nil, NewOAuthError(i18n.MsgOAuthInvalidCode, nil)
	}

	// Get access token using Basic auth
	tokenEndpoint := common.GetEnvOrDefaultString("LINUX_DO_TOKEN_ENDPOINT", "https://connect.linux.do/oauth2/token")
	credentials := common.LinuxDOClientId + ":" + common.LinuxDOClientSecret
	basicAuth := "Basic " + base64.StdEncoding.EncodeToString([]byte(credentials))

	// Get redirect URI from request
	scheme := "http"
	if c.Request.TLS != nil {
		scheme = "https"
	}
	redirectURI := fmt.Sprintf("%s://%s/api/oauth/linuxdo", scheme, c.Request.Host)

	logger.LogDebug(ctx, "[OAuth-LinuxDO] ExchangeToken: token_endpoint=%s, redirect_uri=%s", tokenEndpoint, redirectURI)

	data := url.Values{}
	data.Set("grant_type", "authorization_code")
	data.Set("code", code)
	data.Set("redirect_uri", redirectURI)

	req, err := http.NewRequestWithContext(ctx, "POST", tokenEndpoint, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", basicAuth)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := http.Client{Timeout: 5 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-LinuxDO] ExchangeToken error: %s", err.Error()))
		return nil, NewOAuthErrorWithRaw(i18n.MsgOAuthConnectFailed, map[string]any{"Provider": "Linux DO"}, err.Error())
	}
	defer res.Body.Close()

	logger.LogDebug(ctx, "[OAuth-LinuxDO] ExchangeToken response status: %d", res.StatusCode)

	// Decode token response; Linux Do returns access_token + refresh_token +
	// expires_in (3600s). The refresh_token is kept so the trust level can be
	// refreshed silently later without re-consenting.
	var tokenRes struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		Error        string `json:"error"`
		Message      string `json:"message"`
	}
	if err := json.NewDecoder(res.Body).Decode(&tokenRes); err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-LinuxDO] ExchangeToken decode error: %s", err.Error()))
		return nil, err
	}

	if tokenRes.AccessToken == "" {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-LinuxDO] ExchangeToken failed: %s (%s)", tokenRes.Message, tokenRes.Error))
		return nil, NewOAuthErrorWithRaw(i18n.MsgOAuthTokenFailed, map[string]any{"Provider": "Linux DO"}, tokenRes.Message)
	}

	logger.LogDebug(ctx, "[OAuth-LinuxDO] ExchangeToken success")

	return &OAuthToken{
		AccessToken:  tokenRes.AccessToken,
		RefreshToken: tokenRes.RefreshToken,
		ExpiresIn:    tokenRes.ExpiresIn,
	}, nil
}

// RefreshAccessToken exchanges a refresh_token for a fresh access_token at the
// Linux Do token endpoint (grant_type=refresh_token). A refreshed response may
// also carry a new refresh_token, which callers should persist back.
func (p *LinuxDOProvider) RefreshAccessToken(ctx context.Context, refreshToken string) (*OAuthToken, error) {
	if refreshToken == "" {
		return nil, ErrLinuxDOTokenInvalid
	}

	tokenEndpoint := common.GetEnvOrDefaultString("LINUX_DO_TOKEN_ENDPOINT", "https://connect.linux.do/oauth2/token")
	credentials := common.LinuxDOClientId + ":" + common.LinuxDOClientSecret
	basicAuth := "Basic " + base64.StdEncoding.EncodeToString([]byte(credentials))

	data := url.Values{}
	data.Set("grant_type", "refresh_token")
	data.Set("refresh_token", refreshToken)

	req, err := http.NewRequestWithContext(ctx, "POST", tokenEndpoint, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", basicAuth)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := http.Client{Timeout: 5 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-LinuxDO] RefreshAccessToken error: %s", err.Error()))
		return nil, NewOAuthErrorWithRaw(i18n.MsgOAuthConnectFailed, map[string]any{"Provider": "Linux DO"}, err.Error())
	}
	defer res.Body.Close()

	var tokenRes struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		Error        string `json:"error"`
		Message      string `json:"message"`
	}
	if err := json.NewDecoder(res.Body).Decode(&tokenRes); err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-LinuxDO] RefreshAccessToken decode error: %s", err.Error()))
		return nil, err
	}

	if tokenRes.AccessToken == "" {
		// An expired/revoked refresh_token comes back as invalid_grant; treat it
		// as re-auth required rather than a transient failure.
		if tokenRes.Error == "invalid_grant" || tokenRes.Message != "" {
			return nil, ErrLinuxDOTokenInvalid
		}
		return nil, NewOAuthErrorWithRaw(i18n.MsgOAuthTokenFailed, map[string]any{"Provider": "Linux DO"}, tokenRes.Message)
	}

	return &OAuthToken{
		AccessToken:  tokenRes.AccessToken,
		RefreshToken: tokenRes.RefreshToken,
		ExpiresIn:    tokenRes.ExpiresIn,
	}, nil
}

// ErrLinuxDOTokenInvalid marks a Linux Do refresh_token that has been revoked or
// expired (invalid_grant), meaning the user must re-authorize. Silent refresh
// paths (scheduled task, manual refresh button) use it to decide whether to fall
// back to a full OAuth consent flow.
var ErrLinuxDOTokenInvalid = NewOAuthError(i18n.MsgOAuthTokenFailed, map[string]any{"Provider": "Linux DO"})

func (p *LinuxDOProvider) GetUserInfo(ctx context.Context, token *OAuthToken) (*OAuthUser, error) {
	return p.fetchUserInfo(ctx, token, true)
}

// GetUserInfoForRefresh fetches the user profile for a silent level refresh. It
// skips the trust-level minimum and blacklist checks because refreshing an
// existing account is not a login gate; a level drop must still be reflected,
// not denied.
func (p *LinuxDOProvider) GetUserInfoForRefresh(ctx context.Context, token *OAuthToken) (*OAuthUser, error) {
	return p.fetchUserInfo(ctx, token, false)
}

func (p *LinuxDOProvider) fetchUserInfo(ctx context.Context, token *OAuthToken, enforce bool) (*OAuthUser, error) {
	userEndpoint := common.GetEnvOrDefaultString("LINUX_DO_USER_ENDPOINT", "https://connect.linux.do/api/user")

	logger.LogDebug(ctx, "[OAuth-LinuxDO] GetUserInfo: user_endpoint=%s", userEndpoint)

	req, err := http.NewRequestWithContext(ctx, "GET", userEndpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token.AccessToken)
	req.Header.Set("Accept", "application/json")

	client := http.Client{Timeout: 5 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-LinuxDO] GetUserInfo error: %s", err.Error()))
		return nil, NewOAuthErrorWithRaw(i18n.MsgOAuthConnectFailed, map[string]any{"Provider": "Linux DO"}, err.Error())
	}
	defer res.Body.Close()

	logger.LogDebug(ctx, "[OAuth-LinuxDO] GetUserInfo response status: %d", res.StatusCode)

	var linuxdoUser linuxdoUser
	if err := json.NewDecoder(res.Body).Decode(&linuxdoUser); err != nil {
		logger.LogError(ctx, fmt.Sprintf("[OAuth-LinuxDO] GetUserInfo decode error: %s", err.Error()))
		return nil, err
	}

	if linuxdoUser.Id == 0 {
		logger.LogError(ctx, "[OAuth-LinuxDO] GetUserInfo failed: invalid user id")
		return nil, NewOAuthError(i18n.MsgOAuthUserInfoEmpty, map[string]any{"Provider": "Linux DO"})
	}

	logger.LogDebug(ctx, "[OAuth-LinuxDO] GetUserInfo: id=%d, username=%s, name=%s, trust_level=%d, active=%v, silenced=%v",
		linuxdoUser.Id, linuxdoUser.Username, linuxdoUser.Name, linuxdoUser.TrustLevel, linuxdoUser.Active, linuxdoUser.Silenced)

	if enforce {
		// Check trust level
		if linuxdoUser.TrustLevel < common.LinuxDOMinimumTrustLevel {
			logger.LogWarn(ctx, fmt.Sprintf("[OAuth-LinuxDO] GetUserInfo: trust level too low (required=%d, current=%d)",
				common.LinuxDOMinimumTrustLevel, linuxdoUser.TrustLevel))
			return nil, &TrustLevelError{
				Required: common.LinuxDOMinimumTrustLevel,
				Current:  linuxdoUser.TrustLevel,
			}
		}

		// Check blacklist (id or username)
		if common.IsLinuxDOBlacklisted(linuxdoUser.Id, linuxdoUser.Username) {
			logger.LogWarn(ctx, fmt.Sprintf("[OAuth-LinuxDO] GetUserInfo: user is blacklisted (id=%d, username=%s)",
				linuxdoUser.Id, linuxdoUser.Username))
			return nil, &LinuxDOBlacklistedError{}
		}
	}

	logger.LogDebug(ctx, "[OAuth-LinuxDO] GetUserInfo success: id=%d, username=%s", linuxdoUser.Id, linuxdoUser.Username)

	return &OAuthUser{
		ProviderUserID: strconv.Itoa(linuxdoUser.Id),
		Username:       linuxdoUser.Username,
		DisplayName:    linuxdoUser.Name,
		Avatar:         linuxdoUser.AvatarURL,
		Extra: map[string]any{
			"trust_level": linuxdoUser.TrustLevel,
			"active":      linuxdoUser.Active,
			"silenced":    linuxdoUser.Silenced,
		},
	}, nil
}

func (p *LinuxDOProvider) IsUserIDTaken(providerUserID string) bool {
	return model.IsLinuxDOIdAlreadyTaken(providerUserID)
}

func (p *LinuxDOProvider) FillUserByProviderID(user *model.User, providerUserID string) error {
	user.LinuxDOId = providerUserID
	return user.FillUserByLinuxDOId()
}

func (p *LinuxDOProvider) SetProviderUserID(user *model.User, providerUserID string) {
	user.LinuxDOId = providerUserID
}

func (p *LinuxDOProvider) GetProviderPrefix() string {
	return "linuxdo_"
}

// ProviderUserIDColumn returns the users-table column storing this provider's user ID.
func (p *LinuxDOProvider) ProviderUserIDColumn() string {
	return "linux_do_id"
}

// TrustLevelError indicates the user's trust level is too low
type TrustLevelError struct {
	Required int
	Current  int
}

func (e *TrustLevelError) Error() string {
	return "trust level too low"
}

// LinuxDOBlacklistedError indicates the LinuxDO account is on the blacklist,
// so the user is denied even if the trust level is sufficient.
type LinuxDOBlacklistedError struct{}

func (e *LinuxDOBlacklistedError) Error() string {
	return "linuxdo account is blacklisted"
}
