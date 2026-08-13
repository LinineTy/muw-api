package controller

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const oauthAuthFlowTTL = 10 * time.Minute

type oauthStateRequest struct {
	Provider string `json:"provider"`
	Intent   string `json:"intent"`
	Aff      string `json:"aff,omitempty"`
}

type oauthFlowPayload struct {
	AffiliateCode string `json:"affiliate_code,omitempty"`
}

// providerParams returns map with Provider key for i18n templates
func providerParams(name string) map[string]any {
	return map[string]any{"Provider": name}
}

// GenerateOAuthCode generates a state code for OAuth CSRF protection
func GenerateOAuthCode(c *gin.Context) {
	var request oauthStateRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	request.Provider = strings.TrimSpace(request.Provider)
	request.Intent = strings.TrimSpace(request.Intent)
	request.Aff = strings.TrimSpace(request.Aff)
	if oauth.GetProvider(request.Provider) == nil ||
		(request.Intent != model.AuthFlowIntentLogin &&
			request.Intent != model.AuthFlowIntentBind &&
			request.Intent != model.AuthFlowIntentRefresh) ||
		len(request.Aff) > 32 ||
		((request.Intent == model.AuthFlowIntentBind || request.Intent == model.AuthFlowIntentRefresh) && request.Aff != "") {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}
	userID := 0
	sessionID := ""
	if request.Intent == model.AuthFlowIntentBind || request.Intent == model.AuthFlowIntentRefresh {
		identity, ok := middleware.GetSessionAuthIdentity(c)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "绑定操作需要登录"})
			return
		}
		userID = identity.UserID
		sessionID = identity.SessionID
	}
	payload, err := common.Marshal(oauthFlowPayload{AffiliateCode: request.Aff})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	expiresAt := time.Now().Add(oauthAuthFlowTTL)
	state, _, err := model.CreateAuthFlow(model.AuthFlowCreate{
		Purpose:   model.AuthFlowPurposeOAuth,
		Provider:  request.Provider,
		Intent:    request.Intent,
		UserId:    userID,
		SessionId: sessionID,
		Payload:   string(payload),
		ExpiresAt: expiresAt,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"flow_token": state,
			"expires_at": expiresAt.Unix(),
		},
	})
}

// HandleOAuth handles OAuth callback for all standard OAuth providers
func HandleOAuth(c *gin.Context) {
	providerName := c.Param("provider")
	provider := oauth.GetProvider(providerName)
	if provider == nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": i18n.T(c, i18n.MsgOAuthUnknownProvider),
		})
		return
	}

	// 1. Validate state (CSRF protection)
	state := c.Query("state")
	pendingFlow, err := model.GetAuthFlow(state, model.AuthFlowMatch{
		Purpose:  model.AuthFlowPurposeOAuth,
		Provider: providerName,
	})
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": i18n.T(c, i18n.MsgOAuthStateInvalid),
		})
		return
	}

	consumeMatch := model.AuthFlowMatch{
		Purpose:  model.AuthFlowPurposeOAuth,
		Provider: providerName,
		Intent:   pendingFlow.Intent,
	}
	// 2. Bind and refresh flows are bound to the live dashboard Session that
	// created them; a refresh re-consents an already-logged-in user without
	// starting a new login session.
	if pendingFlow.Intent == model.AuthFlowIntentBind || pendingFlow.Intent == model.AuthFlowIntentRefresh {
		identity, ok := middleware.GetSessionAuthIdentity(c)
		if !ok || identity.UserID != pendingFlow.UserId || identity.SessionID != pendingFlow.SessionId {
			c.JSON(http.StatusForbidden, gin.H{
				"success": false,
				"message": i18n.T(c, i18n.MsgOAuthStateInvalid),
			})
			return
		}
		consumeMatch.UserId = identity.UserID
		consumeMatch.SessionId = identity.SessionID
	} else if pendingFlow.Intent != model.AuthFlowIntentLogin {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}

	// 3. Check if provider is enabled
	if !provider.IsEnabled() {
		common.ApiErrorI18n(c, i18n.MsgOAuthNotEnabled, providerParams(provider.GetName()))
		return
	}

	// 4. Handle error from provider
	errorCode := c.Query("error")
	if errorCode != "" {
		if _, err := model.ConsumeAuthFlow(state, consumeMatch); err != nil {
			c.JSON(http.StatusForbidden, gin.H{"success": false, "message": i18n.T(c, i18n.MsgOAuthStateInvalid)})
			return
		}
		errorDescription := c.Query("error_description")
		if errorDescription == "" {
			errorDescription = errorCode
		}
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": errorDescription,
		})
		return
	}
	if pendingFlow.Intent == model.AuthFlowIntentBind {
		handleOAuthBind(c, provider, pendingFlow, state)
		return
	}
	if pendingFlow.Intent == model.AuthFlowIntentRefresh {
		handleOAuthRefresh(c, provider, pendingFlow, state)
		return
	}

	// 5. Exchange code for token
	code := c.Query("code")
	token, err := provider.ExchangeToken(c.Request.Context(), code, c)
	if err != nil {
		handleOAuthError(c, err)
		return
	}

	// 6. Get user info
	oauthUser, err := provider.GetUserInfo(c.Request.Context(), token)
	if err != nil {
		handleOAuthError(c, err)
		return
	}
	flow, err := model.ConsumeAuthFlow(state, consumeMatch)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": i18n.T(c, i18n.MsgOAuthStateInvalid)})
		return
	}

	// 7. Find or create user
	var payload oauthFlowPayload
	if err := common.UnmarshalJsonStr(flow.Payload, &payload); err != nil {
		common.ApiError(c, err)
		return
	}
	user, err := findOrCreateOAuthUser(c, provider, oauthUser, payload.AffiliateCode)
	if err != nil {
		if errors.Is(err, model.ErrEmailAlreadyTaken) {
			common.ApiErrorI18n(c, i18n.MsgUserEmailAlreadyTaken)
			return
		}
		switch err.(type) {
		case *OAuthUserDeletedError:
			common.ApiErrorLoginDenied(c, common.LoginStatusUserDeleted, i18n.MsgOAuthUserDeleted, "")
		case *OAuthRegistrationDisabledError:
			common.ApiErrorLoginDenied(c, common.LoginStatusRegistrationDisabled, i18n.MsgUserRegisterDisabled, "")
		case *OAuthEmailAlreadyTakenError:
			common.ApiErrorI18n(c, i18n.MsgUserEmailAlreadyTaken)
		default:
			common.ApiError(c, err)
		}
		return
	}

	// 8. Check user status
	if user.Status != common.UserStatusEnabled {
		common.ApiErrorLoginDenied(c, common.LoginStatusUserDisabled, i18n.MsgOAuthUserBanned, user.Remark)
		return
	}

	// 8.5 Persist the OAuth tokens (LinuxDO only) so the trust level can be
	// refreshed silently later without another consent.
	persistLinuxDOToken(provider, user, token)

	// 9. Setup login
	setupLogin(user, c)
}

// handleOAuthBind handles binding OAuth account to existing user
func handleOAuthBind(c *gin.Context, provider oauth.Provider, pendingFlow *model.AuthFlow, flowToken string) {
	// Exchange code for token
	code := c.Query("code")
	token, err := provider.ExchangeToken(c.Request.Context(), code, c)
	if err != nil {
		handleOAuthError(c, err)
		return
	}

	// Get user info
	oauthUser, err := provider.GetUserInfo(c.Request.Context(), token)
	if err != nil {
		handleOAuthError(c, err)
		return
	}

	// Check if this OAuth account is already bound (check both new ID and legacy ID)
	if provider.IsUserIDTaken(oauthUser.ProviderUserID) {
		common.ApiErrorI18n(c, i18n.MsgOAuthAlreadyBound, providerParams(provider.GetName()))
		return
	}
	// Also check legacy ID to prevent duplicate bindings during migration period
	if legacyID, ok := oauthUser.Extra["legacy_id"].(string); ok && legacyID != "" {
		if provider.IsUserIDTaken(legacyID) {
			common.ApiErrorI18n(c, i18n.MsgOAuthAlreadyBound, providerParams(provider.GetName()))
			return
		}
	}

	if _, err := model.ConsumeAuthFlow(flowToken, model.AuthFlowMatch{
		Purpose:   model.AuthFlowPurposeOAuth,
		Provider:  pendingFlow.Provider,
		Intent:    model.AuthFlowIntentBind,
		UserId:    pendingFlow.UserId,
		SessionId: pendingFlow.SessionId,
	}); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": i18n.T(c, i18n.MsgOAuthStateInvalid)})
		return
	}

	user := model.User{Id: pendingFlow.UserId}
	err = user.FillUserById()
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// Handle binding based on provider type
	if genericProvider, ok := provider.(*oauth.GenericOAuthProvider); ok {
		// Custom provider: use user_oauth_bindings table
		err = model.UpdateUserOAuthBinding(user.Id, genericProvider.GetProviderId(), oauthUser.ProviderUserID)
		if err != nil {
			common.ApiError(c, err)
			return
		}
	} else {
		// Built-in provider: update user record directly
		provider.SetProviderUserID(&user, oauthUser.ProviderUserID)
		err = user.Update(false)
		if err != nil {
			common.ApiError(c, err)
			return
		}
	}

	// Persist LinuxDO OAuth tokens so the bound account's trust level can be
	// refreshed silently later.
	persistLinuxDOToken(provider, &user, token)

	common.ApiSuccessI18n(c, i18n.MsgOAuthBindSuccess, gin.H{
		"action": "bind",
	})
}

// persistLinuxDOToken stores the OAuth tokens for LinuxDO accounts (a no-op for
// other providers) so their trust level can be refreshed silently later. Token
// persistence is best-effort: a failure only degrades silent refresh, never the
// login or bind itself.
func persistLinuxDOToken(provider oauth.Provider, user *model.User, token *oauth.OAuthToken) {
	if user == nil || token == nil {
		return
	}
	if _, ok := provider.(*oauth.LinuxDOProvider); !ok {
		return
	}
	expiresAt := time.Now().Add(time.Duration(token.ExpiresIn) * time.Second).Unix()
	if err := model.PersistLinuxDOTokens(user.Id, token.AccessToken, token.RefreshToken, expiresAt); err != nil {
		common.SysError(fmt.Sprintf("[OAuth-LinuxDO] failed to persist tokens for user %d: %s", user.Id, err.Error()))
	}
}

// handleOAuthRefresh handles the refresh-consent callback: the user re-authorizes
// with Linux Do so their trust level and the stored OAuth tokens can be
// refreshed. Unlike login it does NOT setup a new session — the user stays on
// their existing login.
func handleOAuthRefresh(c *gin.Context, provider oauth.Provider, pendingFlow *model.AuthFlow, state string) {
	lp, ok := provider.(*oauth.LinuxDOProvider)
	if !ok {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}

	code := c.Query("code")
	token, err := lp.ExchangeToken(c.Request.Context(), code, c)
	if err != nil {
		handleOAuthError(c, err)
		return
	}

	oauthUser, err := lp.GetUserInfoForRefresh(c.Request.Context(), token)
	if err != nil {
		handleOAuthError(c, err)
		return
	}

	if _, err := model.ConsumeAuthFlow(state, model.AuthFlowMatch{
		Purpose:   model.AuthFlowPurposeOAuth,
		Provider:  pendingFlow.Provider,
		Intent:    model.AuthFlowIntentRefresh,
		UserId:    pendingFlow.UserId,
		SessionId: pendingFlow.SessionId,
	}); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": i18n.T(c, i18n.MsgOAuthStateInvalid)})
		return
	}

	user := model.User{Id: pendingFlow.UserId}
	if err := user.FillUserById(); err != nil {
		common.ApiError(c, err)
		return
	}

	applyLinuxDOProfile(&user, oauthUser, false)
	persistLinuxDOToken(provider, &user, token)

	common.ApiSuccessI18n(c, i18n.MsgOAuthBindSuccess, gin.H{
		"action":      "refresh",
		"trust_level": user.LinuxDOTrustLevel,
		"group":       user.Group,
	})
}

// RefreshLinuxDOTrustLevel is the silent manual refresh endpoint. It uses the
// stored LinuxDO refresh token to pull the latest trust level without any user
// interaction. When the stored token is missing/revoked it returns a
// "reauth_required" code so the client falls back to the interactive
// refresh-consent flow.
func RefreshLinuxDOTrustLevel(c *gin.Context) {
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "登录状态已失效"})
		return
	}

	user := model.User{Id: identity.UserID}
	if err := user.FillUserById(); err != nil {
		common.ApiError(c, err)
		return
	}
	if user.LinuxDOId == "" {
		common.ApiErrorI18n(c, i18n.MsgInvalidParams)
		return
	}

	_, refresh, _, err := model.LoadLinuxDOTokens(user.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if refresh == "" {
		// 200 + business code so the client interceptor does not treat this as a
		// session-expiry 401 (which would refresh + replay the request).
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"code":    "reauth_required",
			"message": "需要重新授权以刷新 LinuxDo 等级",
		})
		return
	}

	provider := &oauth.LinuxDOProvider{}
	token, err := provider.RefreshAccessToken(c.Request.Context(), refresh)
	if err != nil {
		if errors.Is(err, oauth.ErrLinuxDOTokenInvalid) {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"code":    "reauth_required",
				"message": "需要重新授权以刷新 LinuxDo 等级",
			})
			return
		}
		handleOAuthError(c, err)
		return
	}

	oauthUser, err := provider.GetUserInfoForRefresh(c.Request.Context(), token)
	if err != nil {
		handleOAuthError(c, err)
		return
	}

	applyLinuxDOProfile(&user, oauthUser, false)
	persistLinuxDOToken(provider, &user, token)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"action":      "refresh",
			"trust_level": user.LinuxDOTrustLevel,
			"group":       user.Group,
		},
	})
}

// findOrCreateOAuthUser finds existing user or creates new user
func findOrCreateOAuthUser(c *gin.Context, provider oauth.Provider, oauthUser *oauth.OAuthUser, affiliateCode string) (*model.User, error) {
	user := &model.User{}

	// Check if user already exists with new ID
	if provider.IsUserIDTaken(oauthUser.ProviderUserID) {
		err := provider.FillUserByProviderID(user, oauthUser.ProviderUserID)
		if err != nil {
			return nil, err
		}
		// Check if user has been deleted
		if user.Id == 0 {
			return nil, &OAuthUserDeletedError{}
		}
		if _, ok := provider.(*oauth.LinuxDOProvider); ok {
			applyLinuxDOProfile(user, oauthUser, false)
		}
		if oauthUser.Avatar != "" {
			if err := user.SyncOAuthAvatar(oauthUser.Avatar); err != nil {
				common.SysError(fmt.Sprintf("[OAuth] failed to sync avatar for user %d: %s", user.Id, err.Error()))
			}
		}
		return user, nil
	}

	// Try to find user with legacy ID (for GitHub migration from login to numeric ID)
	if legacyID, ok := oauthUser.Extra["legacy_id"].(string); ok && legacyID != "" {
		if provider.IsUserIDTaken(legacyID) {
			err := provider.FillUserByProviderID(user, legacyID)
			if err != nil {
				return nil, err
			}
			if user.Id != 0 {
				// Found user with legacy ID, migrate to new ID
				common.SysLog(fmt.Sprintf("[OAuth] Migrating user %d from legacy_id=%s to new_id=%s",
					user.Id, legacyID, oauthUser.ProviderUserID))
				if err := user.UpdateGitHubId(oauthUser.ProviderUserID); err != nil {
					common.SysError(fmt.Sprintf("[OAuth] Failed to migrate user %d: %s", user.Id, err.Error()))
					// Continue with login even if migration fails
				}
				return user, nil
			}
		}
	}

	// User doesn't exist, create new user if registration is enabled
	if !common.RegisterEnabled {
		return nil, &OAuthRegistrationDisabledError{}
	}

	// Set up new user
	user.Username = provider.GetProviderPrefix() + strconv.Itoa(model.GetMaxUserId()+1)

	if oauthUser.Username != "" {
		if exists, err := model.CheckUserExistOrDeleted(oauthUser.Username, ""); err == nil && !exists {
			// 防止索引退化
			if len(oauthUser.Username) <= model.UserNameMaxLength {
				user.Username = oauthUser.Username
			}
		}
	}

	if oauthUser.DisplayName != "" {
		user.DisplayName = oauthUser.DisplayName
	} else if oauthUser.Username != "" {
		user.DisplayName = oauthUser.Username
	} else {
		user.DisplayName = provider.GetName() + " User"
	}
	if oauthUser.Email != "" {
		user.Email = model.NormalizeEmail(oauthUser.Email)
		if err := model.EnsureEmailAvailable(user.Email, 0); err != nil {
			if errors.Is(err, model.ErrEmailAlreadyTaken) {
				return nil, &OAuthEmailAlreadyTakenError{}
			}
			return nil, err
		}
	}
	user.Role = common.RoleCommonUser
	user.Status = common.UserStatusEnabled
	user.Group = common.DefaultUserGroup
	user.Avatar = oauthUser.Avatar
	if _, ok := provider.(*oauth.LinuxDOProvider); ok {
		applyLinuxDOProfile(user, oauthUser, true)
	}

	// Handle affiliate code
	inviterId := 0
	if affiliateCode != "" && operation_setting.AffiliateProgramEnabled {
		inviterId, _ = model.GetUserIdByAffCode(affiliateCode)
	}

	// Use transaction to ensure user creation and OAuth binding are atomic
	if genericProvider, ok := provider.(*oauth.GenericOAuthProvider); ok {
		// Custom provider: create user and binding in a transaction
		err := model.DB.Transaction(func(tx *gorm.DB) error {
			// Create user
			if err := user.InsertWithTx(tx, inviterId); err != nil {
				return err
			}

			// Create OAuth binding
			binding := &model.UserOAuthBinding{
				UserId:         user.Id,
				ProviderId:     genericProvider.GetProviderId(),
				ProviderUserId: oauthUser.ProviderUserID,
			}
			if err := model.CreateUserOAuthBindingWithTx(tx, binding); err != nil {
				return err
			}

			return nil
		})
		if err != nil {
			return nil, err
		}

		// Perform post-transaction tasks (logs, sidebar config, inviter rewards)
		user.FinalizeOAuthUserCreation(inviterId)
	} else {
		// Built-in provider: create user and update provider ID in a transaction
		err := model.DB.Transaction(func(tx *gorm.DB) error {
			// Create user
			if err := user.InsertWithTx(tx, inviterId); err != nil {
				return err
			}

			// Set the provider user ID on the user model and update
			provider.SetProviderUserID(user, oauthUser.ProviderUserID)
			if err := tx.Model(user).Updates(map[string]interface{}{
				"github_id":   user.GitHubId,
				"discord_id":  user.DiscordId,
				"oidc_id":     user.OidcId,
				"linux_do_id": user.LinuxDOId,
				"wechat_id":   user.WeChatId,
				"telegram_id": user.TelegramId,
			}).Error; err != nil {
				return err
			}

			return nil
		})
		if err != nil {
			return nil, err
		}

		// Perform post-transaction tasks
		user.FinalizeOAuthUserCreation(inviterId)
	}

	return user, nil
}

// applyLinuxDOProfile persists the LinuxDO trust level and keeps the user's
// group in sync with the configured trust-level → group mapping. For existing
// users the group is only re-synced while it is still auto-managed (GroupAuto),
// so an administrator's manual override is never silently overwritten.
func applyLinuxDOProfile(user *model.User, oauthUser *oauth.OAuthUser, isNew bool) {
	if user == nil {
		return
	}
	trustLevel, _ := oauthUser.Extra["trust_level"].(int)

	if isNew {
		// New LinuxDO user: record the trust level and, when a mapping is
		// configured, assign the mapped group and mark the group auto-managed.
		user.LinuxDOTrustLevel = trustLevel
		if len(common.LinuxDOGroupMapping) > 0 {
			user.GroupAuto = true
			user.Group = common.LinuxDOGroupForTrustLevel(trustLevel)
		}
		return
	}

	// Existing user: always refresh the trust level for display.
	group := ""
	if len(common.LinuxDOGroupMapping) > 0 && user.GroupAuto {
		group = common.LinuxDOGroupForTrustLevel(trustLevel)
	}
	if trustLevel == user.LinuxDOTrustLevel && (group == "" || group == user.Group) {
		return
	}
	if group == "" {
		group = user.Group // only the trust level changed; keep the current group
	}
	if err := model.SyncLinuxDOProfile(user, trustLevel, group, user.GroupAuto); err != nil {
		common.SysError(fmt.Sprintf("[OAuth-LinuxDO] failed to sync profile for user %d: %s", user.Id, err.Error()))
	}
}

// Error types for OAuth
type OAuthUserDeletedError struct{}

func (e *OAuthUserDeletedError) Error() string {
	return "user has been deleted"
}

type OAuthRegistrationDisabledError struct{}

func (e *OAuthRegistrationDisabledError) Error() string {
	return "registration is disabled"
}

type OAuthEmailAlreadyTakenError struct{}

func (e *OAuthEmailAlreadyTakenError) Error() string {
	return "email is already in use"
}

// handleOAuthError handles OAuth errors and returns translated message
func handleOAuthError(c *gin.Context, err error) {
	switch e := err.(type) {
	case *oauth.OAuthError:
		if e.Params != nil {
			common.ApiErrorI18n(c, e.MsgKey, e.Params)
		} else {
			common.ApiErrorI18n(c, e.MsgKey)
		}
	case *oauth.AccessDeniedError:
		common.ApiErrorMsg(c, e.Message)
	case *oauth.TrustLevelError:
		common.ApiErrorI18n(c, i18n.MsgOAuthTrustLevelLow)
	case *oauth.LinuxDOBlacklistedError:
		common.ApiErrorLoginDenied(c, common.LoginStatusLinuxDOBlacklisted, i18n.MsgOAuthLinuxDOBlacklisted, "")
	default:
		if errors.Is(err, model.ErrUserLimitReached) {
			common.ApiErrorLoginDenied(c, common.LoginStatusUserLimitReached, i18n.MsgUserLimitReached, "")
			return
		}
		common.ApiError(c, err)
	}
}
