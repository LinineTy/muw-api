package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/service/authz"

	// Import oauth package to register providers via init()
	_ "github.com/QuantumNous/new-api/oauth"

	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
)

func SetApiRouter(router *gin.Engine) {
	apiRouter := router.Group("/api")
	apiRouter.Use(middleware.RouteTag("api"))
	apiRouter.Use(gzip.Gzip(gzip.DefaultCompression))
	apiRouter.Use(middleware.AccessTokenAudit())
	apiRouter.Use(middleware.BodyStorageCleanup()) // 清理请求体存储
	apiRouter.Use(middleware.GlobalAPIRateLimit())
	anonymousRequestBodyLimit := middleware.AnonymousRequestBodyLimit()
	{
		apiRouter.GET("/setup", controller.GetSetup)
		apiRouter.POST("/setup", anonymousRequestBodyLimit, controller.PostSetup)
		apiRouter.GET("/status", controller.GetStatus)
		apiRouter.GET("/status/update-check", middleware.AdminAuth(), controller.GetUpdateCheck)
		apiRouter.GET("/status/changelog", middleware.AdminAuth(), controller.GetChangelog)
		apiRouter.GET("/uptime/status", controller.GetUptimeKumaStatus)
		apiRouter.GET("/models", middleware.UserAuth(), controller.DashboardListModels)
		apiRouter.GET("/status/test", middleware.AdminAuth(), controller.TestStatus)
		apiRouter.GET("/notice", controller.GetNotice)
		apiRouter.GET("/user-agreement", controller.GetUserAgreement)
		apiRouter.GET("/privacy-policy", controller.GetPrivacyPolicy)
		apiRouter.GET("/about", controller.GetAbout)
		//apiRouter.GET("/midjourney", controller.GetMidjourney)
		apiRouter.GET("/home_page_content", controller.GetHomePageContent)
		apiRouter.GET("/pricing", middleware.HeaderNavModuleAuth("pricing"), controller.GetPricing)
		perfMetricsRoute := apiRouter.Group("/perf-metrics")
		perfMetricsRoute.Use(middleware.HeaderNavModulePublicOrUserAuth("pricing"))
		{
			perfMetricsRoute.GET("/summary", controller.GetPerfMetricsSummary)
			perfMetricsRoute.GET("", controller.GetPerfMetrics)
		}
		apiRouter.GET("/rankings", middleware.HeaderNavModuleAuth("rankings"), controller.GetRankings)
		apiRouter.GET("/verification", middleware.EmailVerificationRateLimit(), middleware.TurnstileCheck(), controller.SendEmailVerification)
		apiRouter.GET("/reset_password", middleware.CriticalRateLimit(), middleware.TurnstileCheck(), controller.SendPasswordResetEmail)
		apiRouter.POST("/user/reset", middleware.CriticalRateLimit(), anonymousRequestBodyLimit, controller.ResetPassword)
		// OAuth routes - specific routes must come before :provider wildcard
		apiRouter.POST("/oauth/state", middleware.CriticalRateLimit(), middleware.DisableCache(), middleware.TryUserAuth(), anonymousRequestBodyLimit, controller.GenerateOAuthCode)
		apiRouter.POST("/oauth/email/bind/start", middleware.UserAuth(), middleware.CriticalRateLimit(), middleware.UserCriticalRateLimit("account-security"), middleware.EmailVerificationRateLimit(), middleware.DisableCache(), controller.EmailBindStart)
		apiRouter.POST("/oauth/email/bind/resend", middleware.UserAuth(), middleware.CriticalRateLimit(), middleware.UserCriticalRateLimit("account-security"), middleware.EmailVerificationRateLimit(), middleware.DisableCache(), controller.EmailBindResend)
		apiRouter.POST("/oauth/email/bind", middleware.UserAuth(), middleware.CriticalRateLimit(), middleware.UserCriticalRateLimit("account-security"), middleware.DisableCache(), controller.EmailBind)
		// WeChat uses its existing authorization-code service.
		apiRouter.GET("/oauth/wechat", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.WeChatAuth)
		apiRouter.POST("/oauth/wechat/bind", middleware.UserAuth(), middleware.CriticalRateLimit(), controller.WeChatBind)
		apiRouter.GET("/oauth/telegram/login", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.TelegramLegacyAuth)
		apiRouter.POST("/oauth/telegram/bind/start", middleware.UserAuth(), middleware.CriticalRateLimit(), middleware.DisableCache(), controller.TelegramLegacyAuth)
		apiRouter.GET("/oauth/telegram/bind/:flow_token", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.TelegramLegacyAuth)
		// Silent LinuxDO trust-level refresh (manual button). Must be registered
		// before the /oauth/:provider wildcard.
		apiRouter.POST("/oauth/linuxdo/refresh", middleware.UserAuth(), middleware.CriticalRateLimit(), controller.RefreshLinuxDOTrustLevel)
		// Standard OAuth providers (GitHub, Discord, OIDC, LinuxDO, Telegram) - unified route
		apiRouter.GET("/oauth/:provider", middleware.CriticalRateLimit(), middleware.DisableCache(), middleware.TryUserAuth(), controller.HandleOAuth)
		apiRouter.GET("/ratio_config", middleware.CriticalRateLimit(), controller.GetRatioConfig)

		// Universal secure verification routes
		apiRouter.GET("/verify/methods", middleware.UserAuth(), middleware.DisableCache(), controller.GetVerificationMethods)
		apiRouter.POST("/verify", middleware.UserAuth(), middleware.CriticalRateLimit(), middleware.UserCriticalRateLimit("security-verification"), middleware.DisableCache(), controller.UniversalVerify)

		userRoute := apiRouter.Group("/user")
		{
			userRoute.POST("/auth/refresh", middleware.SessionCookieOriginGuard(), middleware.CriticalRateLimit(), middleware.DisableCache(), controller.RefreshAuth)
			userRoute.POST("/auth/logout", middleware.SessionCookieOriginGuard(), middleware.CriticalRateLimit(), middleware.DisableCache(), controller.AuthLogout)
			userRoute.POST("/register", middleware.CriticalRateLimit(), anonymousRequestBodyLimit, middleware.TurnstileCheck(), controller.Register)
			userRoute.GET("/login/encryption-key", middleware.DisableCache(), controller.GetPasswordEncryptionKey)
			userRoute.POST("/login", middleware.CriticalRateLimit(), middleware.DisableCache(), anonymousRequestBodyLimit, middleware.TurnstileCheck(), controller.Login)
			// 登录/注册/第三方入口的前置校验挑战（匿名可领，绑 IP + 用途，一次性 5 分钟）。
			userRoute.POST("/login_challenge", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.IssueLoginChallenge)
			userRoute.POST("/login/2fa", middleware.CriticalRateLimit(), middleware.DisableCache(), anonymousRequestBodyLimit, controller.Verify2FALogin)
			userRoute.POST("/login/verify", middleware.CriticalRateLimit(), middleware.DisableCache(), anonymousRequestBodyLimit, controller.VerifyLogin)
			userRoute.POST("/login/passkey/begin", middleware.CriticalRateLimit(), middleware.DisableCache(), anonymousRequestBodyLimit, controller.LoginPasskeyBegin)
			userRoute.POST("/login/passkey/finish", middleware.CriticalRateLimit(), middleware.DisableCache(), anonymousRequestBodyLimit, controller.LoginPasskeyFinish)
			userRoute.POST("/passkey/login/begin", middleware.CriticalRateLimit(), middleware.DisableCache(), anonymousRequestBodyLimit, controller.PasskeyLoginBegin)
			userRoute.POST("/passkey/login/finish", middleware.CriticalRateLimit(), middleware.DisableCache(), anonymousRequestBodyLimit, controller.PasskeyLoginFinish)
			//userRoute.POST("/tokenlog", middleware.CriticalRateLimit(), controller.TokenLog)
			userRoute.POST("/epay/notify", anonymousRequestBodyLimit, controller.EpayNotify)
			userRoute.GET("/epay/notify", controller.EpayNotify)
			userRoute.GET("/groups", controller.GetUserGroups)
			// 激活页用接口：UserAuthPending 放行未激活（待激活）账号。
			userRoute.GET("/self", middleware.UserAuthPending(), controller.GetSelf)
			userRoute.POST("/activate", middleware.CriticalRateLimit(), middleware.UserAuthPending(), controller.ActivateInviteCode)
			// 激活页倒计时用：本人若有未结的钓鱼码宽限，返回剩余秒数（待激活账号也要能读）。
			userRoute.GET("/activation_deadline", middleware.UserAuthPending(), controller.GetInviteTrapGraceStatus)
			// 激活页人机校验用：签发一次性 PoW 挑战（难度由 option PoWChallengeBits 控制）。
			userRoute.POST("/activation_challenge", middleware.CriticalRateLimit(), middleware.UserAuthPending(), controller.IssueActivationChallenge)

			selfRoute := userRoute.Group("/")
			selfRoute.Use(middleware.DisableCache(), middleware.UserAuth())
			{
				selfRoute.GET("/sessions", middleware.DisableCache(), controller.GetLoginSessions)
				selfRoute.DELETE("/sessions/:sid", middleware.DisableCache(), controller.DeleteLoginSession)
				selfRoute.POST("/sessions/revoke-others", middleware.DisableCache(), controller.RevokeOtherLoginSessions)
				selfRoute.GET("/self/groups", controller.GetUserGroups)
				selfRoute.GET("/models", controller.GetUserModels)
				selfRoute.PUT("/self", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.UpdateSelf)
				selfRoute.POST("/avatar", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.UploadAvatar)
				selfRoute.DELETE("/self", middleware.DisableCache(), controller.DeleteSelf)
				selfRoute.GET("/token", middleware.CriticalRateLimit(), middleware.UserCriticalRateLimit("access-token"), middleware.DisableCache(), controller.GenerateAccessToken)
				selfRoute.GET("/token/status", middleware.DisableCache(), controller.GetAccessTokenStatus)
				selfRoute.POST("/token", middleware.CriticalRateLimit(), middleware.UserCriticalRateLimit("access-token"), middleware.DisableCache(), controller.GenerateAccessToken)
				selfRoute.DELETE("/token", middleware.CriticalRateLimit(), middleware.UserCriticalRateLimit("access-token"), middleware.DisableCache(), controller.RevokeAccessToken)
				selfRoute.GET("/passkey", controller.PasskeyStatus)
				selfRoute.POST("/passkey/register/begin", middleware.UserCriticalRateLimit("security-verification"), middleware.DisableCache(), controller.PasskeyRegisterBegin)
				selfRoute.POST("/passkey/register/finish", middleware.UserCriticalRateLimit("security-verification"), middleware.DisableCache(), controller.PasskeyRegisterFinish)
				selfRoute.POST("/passkey/verify/begin", middleware.UserCriticalRateLimit("security-verification"), middleware.DisableCache(), controller.PasskeyVerifyBegin)
				selfRoute.POST("/passkey/verify/finish", middleware.UserCriticalRateLimit("security-verification"), middleware.DisableCache(), controller.PasskeyVerifyFinish)
				selfRoute.DELETE("/passkey", middleware.DisableCache(), controller.PasskeyDelete)
				selfRoute.GET("/aff", controller.GetAffCode)
				selfRoute.GET("/topup/info", controller.GetTopUpInfo)
				selfRoute.GET("/topup/self", controller.GetUserTopUps)
				selfRoute.POST("/topup", middleware.CriticalRateLimit(), controller.TopUp)
				selfRoute.GET("/credit", controller.GetUserCreditStatus)
				selfRoute.POST("/credit/pledge", middleware.CriticalRateLimit(), controller.CreditScorePledge)
				selfRoute.POST("/pay", middleware.CriticalRateLimit(), controller.RequestEpay)
				selfRoute.POST("/amount", controller.RequestAmount)
				selfRoute.POST("/aff_transfer", middleware.UserCriticalRateLimit("aff-transfer"), controller.TransferAffQuota)
				selfRoute.PUT("/setting", controller.UpdateUserSetting)

				// 站内消息（自研）：网页「消息」窗口。只读自己的，userId 取会话。
				selfRoute.GET("/notifications", controller.GetUserNotifications)
				selfRoute.POST("/notifications/read", controller.MarkUserNotificationsRead)
				selfRoute.POST("/notifications/read_all", controller.MarkAllUserNotificationsRead)
				selfRoute.POST("/notifications/delete", controller.DeleteUserNotifications)
				selfRoute.POST("/notifications/delete_all", controller.DeleteUserNotificationsByScope)

				// 2FA routes
				selfRoute.GET("/2fa/status", controller.Get2FAStatus)
				selfRoute.POST("/2fa/setup", middleware.UserCriticalRateLimit("security-verification"), middleware.DisableCache(), controller.Setup2FA)
				selfRoute.POST("/2fa/enable", middleware.UserCriticalRateLimit("security-verification"), middleware.DisableCache(), controller.Enable2FA)
				selfRoute.POST("/2fa/disable", middleware.DisableCache(), controller.Disable2FA)
				selfRoute.POST("/2fa/backup_codes", middleware.DisableCache(), controller.RegenerateBackupCodes)

				// Quota pool routes (user)
				selfRoute.GET("/quota-pool", controller.GetQuotaPoolStatus)
				selfRoute.GET("/quota-pool/records", controller.GetQuotaPoolRecords)
				selfRoute.POST("/quota-pool/claim", middleware.QuotaPoolActionRateLimit(), controller.ClaimQuotaPool)
				selfRoute.POST("/quota-pool/checkin", middleware.QuotaPoolActionRateLimit(), controller.QuotaCheckIn)

				// Custom OAuth bindings
				selfRoute.GET("/oauth/bindings", controller.GetUserOAuthBindings)
				selfRoute.DELETE("/oauth/bindings/:provider_id", controller.UnbindCustomOAuth)
			}

			adminRoute := userRoute.Group("/")
			adminRoute.Use(middleware.AdminAuth())
			{
				adminRoute.GET("/", controller.GetAllUsers)
				adminRoute.GET("/topup", controller.GetAllTopUps)
				adminRoute.POST("/topup/complete", controller.AdminCompleteTopUp)
				adminRoute.GET("/search", controller.SearchUsers)
				adminRoute.GET("/:id/oauth/bindings", controller.GetUserOAuthBindingsByAdmin)
				adminRoute.DELETE("/:id/oauth/bindings/:provider_id", controller.UnbindCustomOAuthByAdmin)
				adminRoute.DELETE("/:id/bindings/:binding_type", controller.AdminClearUserBinding)
				adminRoute.GET("/:id", controller.GetUser)
				adminRoute.POST("/", controller.CreateUser)
				adminRoute.POST("/manage", controller.ManageUser)
				adminRoute.PUT("/", controller.UpdateUser)
				adminRoute.DELETE("/:id", controller.DeleteUser)
				adminRoute.DELETE("/:id/reset_passkey", controller.AdminResetPasskey)

				// Admin 2FA routes
				adminRoute.GET("/2fa/stats", controller.Admin2FAStats)
				adminRoute.DELETE("/:id/2fa", controller.AdminDisable2FA)
			}
		}

		// Subscription billing (plans, purchase, admin management)
		subscriptionRoute := apiRouter.Group("/subscription")
		subscriptionRoute.Use(middleware.UserAuth())
		{
			subscriptionRoute.GET("/plans", controller.GetSubscriptionPlans)
			subscriptionRoute.GET("/self", controller.GetSubscriptionSelf)
			subscriptionRoute.PUT("/self/preference", controller.UpdateSubscriptionPreference)
			subscriptionRoute.POST("/balance/pay", middleware.SubscriptionActionRateLimit(), controller.SubscriptionRequestBalancePay)
			subscriptionRoute.POST("/epay/pay", middleware.SubscriptionActionRateLimit(), controller.SubscriptionRequestEpay)
			subscriptionRoute.POST("/cancel", middleware.SubscriptionActionRateLimit(), controller.SubscriptionCancel)
			subscriptionRoute.POST("/renew/balance", middleware.SubscriptionActionRateLimit(), controller.SubscriptionRequestRenewBalance)
			subscriptionRoute.POST("/auto-renew", middleware.SubscriptionActionRateLimit(), controller.SubscriptionUpdateAutoRenew)
			subscriptionRoute.POST("/priority", middleware.SubscriptionActionRateLimit(), controller.SubscriptionUpdatePriority)
			subscriptionRoute.GET("/expiring", controller.GetSubscriptionExpiring)
			subscriptionRoute.GET("/orders", middleware.DisableCache(), controller.GetUserSubscriptionOrders)
		}

		// Group pin (固定分组：商品/我的钉/余额购买 + 管理端商品与钉子管理)
		groupPinRoute := apiRouter.Group("/group_pin")
		groupPinRoute.Use(middleware.UserAuth())
		{
			groupPinRoute.GET("/products", controller.GetGroupPinProducts)
			groupPinRoute.GET("/self", middleware.DisableCache(), controller.GetMyGroupPin)
			groupPinRoute.POST("/balance/pay", middleware.SubscriptionActionRateLimit(), controller.GroupPinBalancePay)
			groupPinRoute.POST("/epay/pay", middleware.SubscriptionActionRateLimit(), controller.GroupPinRequestEpay)
		}
		groupPinAdminRoute := apiRouter.Group("/group_pin/admin")
		groupPinAdminRoute.Use(middleware.AdminAuth())
		{
			groupPinAdminRoute.GET("/products", controller.AdminListGroupPinProducts)
			groupPinAdminRoute.POST("/product/save", controller.AdminSaveGroupPinProduct)
			groupPinAdminRoute.DELETE("/product/:id", controller.AdminDeleteGroupPinProduct)
			groupPinAdminRoute.GET("/pins", controller.AdminListUserGroupPins)
			groupPinAdminRoute.POST("/pin/release", controller.AdminReleaseGroupPin)
		}
		subscriptionAdminRoute := apiRouter.Group("/subscription/admin")
		subscriptionAdminRoute.Use(middleware.AdminAuth())
		{
			subscriptionAdminRoute.GET("/plans", controller.AdminListSubscriptionPlans)
			subscriptionAdminRoute.POST("/plans", controller.AdminCreateSubscriptionPlan)
			subscriptionAdminRoute.PUT("/plans/:id", controller.AdminUpdateSubscriptionPlan)
			subscriptionAdminRoute.PATCH("/plans/:id", controller.AdminUpdateSubscriptionPlanStatus)
			subscriptionAdminRoute.DELETE("/plans/:id", controller.AdminDeleteSubscriptionPlan)
			subscriptionAdminRoute.POST("/bind", controller.AdminBindSubscription)
			subscriptionAdminRoute.POST("/plans/:id/subscriptions/reset", controller.AdminResetPlanSubscriptions)

			// User subscription management (admin)
			subscriptionAdminRoute.GET("/subscriptions", controller.AdminListAllSubscriptions)
			subscriptionAdminRoute.GET("/users/:id/subscriptions", controller.AdminListUserSubscriptions)
			subscriptionAdminRoute.POST("/users/:id/subscriptions", controller.AdminCreateUserSubscription)
			subscriptionAdminRoute.POST("/users/:id/subscriptions/reset", controller.AdminResetUserSubscriptionsByPlan)
			subscriptionAdminRoute.POST("/user_subscriptions/:id/invalidate", controller.AdminInvalidateUserSubscription)
			subscriptionAdminRoute.DELETE("/user_subscriptions/:id", controller.AdminDeleteUserSubscription)
			subscriptionAdminRoute.POST("/user_subscriptions/:id/purge", controller.AdminPurgeUserSubscription)
			subscriptionAdminRoute.GET("/orders", middleware.DisableCache(), controller.AdminListSubscriptionOrders)
			subscriptionAdminRoute.POST("/orders/complete", middleware.DisableCache(), controller.AdminCompleteSubscriptionOrder)
			subscriptionAdminRoute.POST("/orders/reject", middleware.DisableCache(), controller.AdminRejectSubscriptionOrder)
		}

		// Subscription payment callbacks (no auth)
		apiRouter.POST("/subscription/epay/notify", anonymousRequestBodyLimit, controller.SubscriptionEpayNotify)
		apiRouter.GET("/subscription/epay/notify", controller.SubscriptionEpayNotify)
		apiRouter.GET("/subscription/epay/return", controller.SubscriptionEpayReturn)
		apiRouter.POST("/subscription/epay/return", anonymousRequestBodyLimit, controller.SubscriptionEpayReturn)

		// Playground space payment callbacks (no auth): online purchase of cloud space
		apiRouter.POST("/playground/space/epay/notify", anonymousRequestBodyLimit, controller.PlaygroundSpaceEpayNotify)
		apiRouter.GET("/playground/space/epay/notify", controller.PlaygroundSpaceEpayNotify)
		apiRouter.GET("/playground/space/epay/return", controller.PlaygroundSpaceEpayReturn)
		apiRouter.POST("/playground/space/epay/return", anonymousRequestBodyLimit, controller.PlaygroundSpaceEpayReturn)
		optionRoute := apiRouter.Group("/option")
		optionRoute.Use(middleware.RootAuth())
		{
			optionRoute.GET("/", controller.GetOptions)
			optionRoute.GET("/request_policy", controller.GetRequestPolicy)
			optionRoute.PATCH("/request_policy", controller.UpdateRequestPolicy)
			optionRoute.PUT("/", controller.UpdateOption)
			optionRoute.PUT("/passkey/domains", controller.UpdatePasskeyDomains)
			optionRoute.GET("/model_pricing", controller.GetModelPricingConfig)
			optionRoute.PATCH("/model_pricing", controller.UpdateModelPricingConfig)
			optionRoute.POST("/model_pricing/convert", controller.PreviewModelPricingConversion)
			optionRoute.POST("/model_pricing/preview", controller.PreviewModelPricing)
			// MERGE-DECISION: upstream 的 POST /option/payment_compliance 未保留——
			// fork 已删除 controller/payment_compliance.go 及其依赖的 Stripe/Creem/Waffo
			// 支付合规子系统(本合并按 fork 的删除解决),注册该路由会引用不存在的 handler。
			optionRoute.GET("/channel_affinity_cache", controller.GetChannelAffinityCacheStats)
			optionRoute.DELETE("/channel_affinity_cache", controller.ClearChannelAffinityCache)
			optionRoute.POST("/rest_model_ratio", controller.ResetModelRatio)
		}

		// Landing-page theme management (root only)
		homePageThemeRoute := apiRouter.Group("/home-page-theme")
		homePageThemeRoute.Use(middleware.RootAuth())
		{
			homePageThemeRoute.GET("/", controller.GetHomePageThemes)
			homePageThemeRoute.GET("/:id", controller.GetHomePageTheme)
			homePageThemeRoute.POST("/", controller.ImportHomePageTheme)
			homePageThemeRoute.POST("/select", controller.SelectHomePageTheme)
			homePageThemeRoute.PUT("/manual", controller.UpdateHomePageManual)
			homePageThemeRoute.DELETE("/:id", controller.DeleteHomePageTheme)
		}

		// Image library (image host, root only): upload / list / delete images
		// whose files live under <UploadDir>/images and are served by /uploads/.
		imageRoute := apiRouter.Group("/images")
		imageRoute.Use(middleware.RootAuth())
		{
			imageRoute.GET("/", controller.ListImages)
			imageRoute.POST("/", controller.UploadImage)
			imageRoute.DELETE("/:id", controller.DeleteImage)
		}

		// Playground image uploads (any authenticated user): files live under
		// <PrivateUploadDir>/playground-images (NOT under /uploads/), served only
		// through the ownership-checked GET below. TTL GC + quotas in
		// service/playground_image_cleanup.go and setting/playground_setting.go.
		playgroundUploadRoute := apiRouter.Group("/playground")
		playgroundUploadRoute.Use(middleware.UserAuth())
		{
			playgroundUploadRoute.POST("/images", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.UploadPlaygroundImage)
			playgroundUploadRoute.GET("/images", middleware.DisableCache(), controller.ListPlaygroundImages)
			playgroundUploadRoute.GET("/images/:id", middleware.DisableCache(), controller.GetPlaygroundImage)
			playgroundUploadRoute.DELETE("/images/:id", controller.DeletePlaygroundImage)
			playgroundUploadRoute.POST("/images/clear-transient", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.ClearUserTransientPlaygroundImages)
			// 用户云空间：用量/购买 + 对话同步
			playgroundUploadRoute.GET("/space", middleware.DisableCache(), controller.GetUserPlaygroundSpace)
			playgroundUploadRoute.POST("/space/purchase", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.PurchasePlaygroundSpace)
			playgroundUploadRoute.POST("/space/epay/pay", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.RequestPlaygroundSpaceEpay)
			playgroundUploadRoute.GET("/space/orders", middleware.DisableCache(), controller.GetUserPlaygroundSpaceOrders)
			playgroundUploadRoute.GET("/conversations", middleware.DisableCache(), controller.ListPlaygroundConversations)
			playgroundUploadRoute.PUT("/conversations/:clientId", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.SavePlaygroundConversation)
			playgroundUploadRoute.DELETE("/conversations/:clientId", controller.DeletePlaygroundConversation)
		}

		// Playground image admin: global usage stats + manual cleanup (admin only).
		playgroundAdminRoute := apiRouter.Group("/playground/admin")
		playgroundAdminRoute.Use(middleware.AdminAuth())
		{
			playgroundAdminRoute.GET("/images/stats", middleware.DisableCache(), controller.AdminPlaygroundImageStats)
			playgroundAdminRoute.POST("/images/cleanup", middleware.DisableCache(), controller.AdminCleanupPlaygroundImages)
			playgroundAdminRoute.GET("/orders", middleware.DisableCache(), controller.AdminListPlaygroundSpaceOrders)
			playgroundAdminRoute.POST("/orders/complete", middleware.DisableCache(), controller.AdminCompletePlaygroundSpaceOrder)
			playgroundAdminRoute.POST("/orders/reject", middleware.DisableCache(), controller.AdminRejectPlaygroundSpaceOrder)
		}

		// Custom OAuth provider management (root only)
		customOAuthRoute := apiRouter.Group("/custom-oauth-provider")
		customOAuthRoute.Use(middleware.RootAuth())
		{
			customOAuthRoute.POST("/discovery", controller.FetchCustomOAuthDiscovery)
			customOAuthRoute.GET("/", controller.GetCustomOAuthProviders)
			customOAuthRoute.GET("/:id", controller.GetCustomOAuthProvider)
			customOAuthRoute.POST("/", controller.CreateCustomOAuthProvider)
			customOAuthRoute.PUT("/:id", controller.UpdateCustomOAuthProvider)
			customOAuthRoute.DELETE("/:id", controller.DeleteCustomOAuthProvider)
		}
		performanceRoute := apiRouter.Group("/performance")
		performanceRoute.Use(middleware.RootAuth())
		{
			performanceRoute.GET("/stats", controller.GetPerformanceStats)
			performanceRoute.DELETE("/disk_cache", controller.ClearDiskCache)
			performanceRoute.POST("/reset_stats", controller.ResetPerformanceStats)
			performanceRoute.POST("/gc", controller.ForceGC)
			performanceRoute.GET("/logs", controller.GetLogFiles)
			performanceRoute.DELETE("/logs", controller.CleanupLogFiles)
		}
		ratioSyncRoute := apiRouter.Group("/ratio_sync")
		ratioSyncRoute.Use(middleware.RootAuth())
		{
			ratioSyncRoute.GET("/channels", controller.GetSyncableChannels)
			ratioSyncRoute.POST("/fetch", controller.FetchUpstreamRatios)
		}
		taskPluginRoute := apiRouter.Group("/plugin/task")
		taskPluginRoute.Use(middleware.RootAuth())
		{
			taskPluginRoute.GET("", controller.ListTaskPlugins)
			taskPluginRoute.POST("", controller.UploadTaskPlugin)
			taskPluginRoute.PUT("", controller.UploadTaskPlugin)
			taskPluginRoute.GET("/runtime/status", controller.GetTaskPluginRuntime)
			taskPluginRoute.GET("/marketplace/sources", controller.GetTaskPluginMarketplaceSources)
			taskPluginRoute.PUT("/marketplace/sources", controller.UpdateTaskPluginMarketplaceSources)
			taskPluginRoute.GET("/:key", controller.GetTaskPlugin)
			taskPluginRoute.GET("/:key/icon", controller.GetTaskPluginIcon)
			taskPluginRoute.GET("/:key/versions", controller.GetTaskPluginVersions)
			taskPluginRoute.POST("/:key/activate", controller.ActivateTaskPlugin)
			taskPluginRoute.POST("/:key/status", controller.SetTaskPluginStatus)
			taskPluginRoute.POST("/:key/dryrun", controller.DryRunTaskPlugin)
			taskPluginRoute.DELETE("/:key/versions/:version", controller.DeleteTaskPluginVersion)
		}
		apiRouter.GET("/task_plugin_options", middleware.AdminAuth(), middleware.RequirePermission(authz.TaskPluginBind), controller.GetTaskPluginOptions)
		registerChannelRoutes(apiRouter)
		registerAccountRoutes(apiRouter)
		registerAuthzRoutes(apiRouter)
		tokenRoute := apiRouter.Group("/token")
		tokenRoute.Use(middleware.UserAuth())
		tokenRoute.Use(middleware.TokenOperationAudit())
		{
			tokenRoute.GET("/", controller.GetAllTokens)
			tokenRoute.GET("/search", middleware.SearchRateLimit(), controller.SearchTokens)
			tokenRoute.GET("/auto-groups", controller.GetTokenAutoGroups)
			tokenRoute.GET("/:id", controller.GetToken)
			tokenRoute.POST("/:id/key", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.GetTokenKey)
			tokenRoute.POST("/", controller.AddToken)
			tokenRoute.PUT("/", controller.UpdateToken)
			tokenRoute.DELETE("/:id", controller.DeleteToken)
			tokenRoute.POST("/batch", controller.DeleteTokenBatch)
			tokenRoute.POST("/batch/keys", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.GetTokenKeysBatch)
		}

		usageRoute := apiRouter.Group("/usage")
		usageRoute.Use(middleware.CORS(), middleware.CriticalRateLimit())
		{
			tokenUsageRoute := usageRoute.Group("/token")
			tokenUsageRoute.Use(middleware.TokenAuthReadOnly())
			{
				tokenUsageRoute.GET("/", controller.GetTokenUsage)
			}
		}

		redemptionRoute := apiRouter.Group("/redemption")
		redemptionRoute.Use(middleware.AdminAuth())
		{
			redemptionRoute.GET("/", controller.GetAllRedemptions)
			redemptionRoute.GET("/search", controller.SearchRedemptions)
			redemptionRoute.GET("/:id", controller.GetRedemption)
			redemptionRoute.POST("/", controller.AddRedemption)
			redemptionRoute.POST("/batch", controller.DeleteRedemptionBatch)
			redemptionRoute.PUT("/", controller.UpdateRedemption)
			redemptionRoute.DELETE("/invalid", controller.DeleteInvalidRedemption)
			redemptionRoute.DELETE("/:id", controller.DeleteRedemption)
		}
		apiRouter.GET("/audit", middleware.DisableCache(), middleware.AdminAuth(), middleware.RequirePermission(authz.AuditRead), controller.GetAuditLogs)
		apiRouter.GET("/audit/self", middleware.DisableCache(), middleware.UserAuth(), controller.GetAuditLogs)
		logRoute := apiRouter.Group("/log")
		logRoute.GET("/", middleware.AdminAuth(), controller.GetAllLogs)
		logRoute.GET("/stat", middleware.AdminAuth(), controller.GetLogsStat)
		logRoute.GET("/self/stat", middleware.UserAuth(), controller.GetLogsSelfStat)
		logRoute.GET("/channel_affinity_usage_cache", middleware.AdminAuth(), controller.GetChannelAffinityUsageCacheStats)
		logRoute.GET("/search", middleware.AdminAuth(), controller.SearchAllLogs)
		logRoute.GET("/self", middleware.UserAuth(), controller.GetUserLogs)
		logRoute.GET("/self/search", middleware.UserAuth(), middleware.SearchRateLimit(), controller.SearchUserLogs)

		systemTaskRoute := apiRouter.Group("/system-task")
		systemTaskRoute.Use(middleware.RootAuth())
		{
			systemTaskRoute.POST("/log-cleanup", controller.CreateLogCleanupSystemTask)
			systemTaskRoute.GET("/list", controller.ListSystemTasks)
			systemTaskRoute.DELETE("/history", controller.DeleteSystemTaskHistory)
			systemTaskRoute.GET("/current", controller.GetCurrentSystemTask)
			systemTaskRoute.GET("/:task_id", controller.GetSystemTask)
		}
		riskControlRoute := apiRouter.Group("/risk-control")
		riskControlRoute.Use(middleware.RootAuth())
		{
			riskControlRoute.GET("/overview", controller.GetRiskControlOverview)
			riskControlRoute.GET("/users", controller.GetLowCreditScoreUsers)
			riskControlRoute.GET("/logs", controller.GetCreditScoreLogs)
			riskControlRoute.POST("/adjust", controller.AdjustCreditScore)
			riskControlRoute.POST("/revert-deduction", controller.RevertCreditScoreDeduction)
			riskControlRoute.POST("/revert-deductions", controller.RevertCreditScoreDeductions)
			riskControlRoute.POST("/revert-keyword-hits", controller.RevertKeywordHits)
			riskControlRoute.GET("/keyword-stats", controller.GetKeywordHitStats)
			riskControlRoute.GET("/user-hit-stats", controller.GetUserHitStats)
			riskControlRoute.POST("/reset-credit-scores", controller.ResetCreditScores)
			riskControlRoute.GET("/credit-score-reset/status", controller.GetCreditScoreResetStatus)
			riskControlRoute.GET("/markers", controller.GetRiskControlMarkers)
			riskControlRoute.PUT("/markers", controller.SetRiskControlMarkers)
			riskControlRoute.POST("/markers/reset", controller.ResetRiskControlMarkers)
			riskControlRoute.POST("/analyze-markers", controller.AnalyzeMarkers)
			riskControlRoute.GET("/marker-analysis-logs", controller.GetMarkerAnalysisLogs)
			riskControlRoute.GET("/marker-analysis-error-stats", controller.GetMarkerAnalysisErrorStats)
			riskControlRoute.GET("/marker-analysis-token-status", controller.GetMarkerAnalysisTokenStatus)
			riskControlRoute.POST("/marker-analysis/reset-prompt", controller.ResetMarkerAnalysisPrompt)
			riskControlRoute.GET("/marker-analysis/status", controller.GetMarkerAnalysisStatus)
			riskControlRoute.POST("/regenerate-analysis-token", controller.RegenerateAnalysisToken)
			riskControlRoute.POST("/fetch-upstream-models", controller.FetchMarkerAnalysisUpstreamModels)
			riskControlRoute.GET("/marker-suggestions", controller.GetMarkerSuggestions)
			riskControlRoute.POST("/marker-suggestions/:id/accept", controller.AcceptMarkerSuggestion)
			riskControlRoute.POST("/marker-suggestions/:id/reject", controller.RejectMarkerSuggestion)
		}
		visualFallbackRoute := apiRouter.Group("/visual-fallback")
		visualFallbackRoute.Use(middleware.RootAuth())
		{
			visualFallbackRoute.POST("/reset-prompt", controller.ResetVisionFallbackPrompt)
		}
		conversationRecordRoute := apiRouter.Group("/conversation-records")
		// 对话留存含用户请求/响应明文，与风控中心页面对齐为仅 Root 可见。
		conversationRecordRoute.Use(middleware.RootAuth())
		{
			conversationRecordRoute.GET("/", controller.GetConversationRecords)
			conversationRecordRoute.GET("/:id", controller.GetConversationRecordDetail)
		}
		systemInfoRoute := apiRouter.Group("/system-info")
		systemInfoRoute.Use(middleware.RootAuth())
		{
			systemInfoRoute.GET("/instances", controller.ListSystemInstances)
			systemInfoRoute.DELETE("/stale-instances", controller.DeleteStaleSystemInstances)
			systemInfoRoute.DELETE("/instances/:node_name", controller.DeleteStaleSystemInstance)
		}

		dataRoute := apiRouter.Group("/data")
		dataRoute.GET("/", middleware.AdminAuth(), controller.GetAllQuotaDates)
		dataRoute.GET("/users", middleware.AdminAuth(), controller.GetQuotaDatesByUser)
		dataRoute.GET("/self", middleware.UserAuth(), controller.GetUserQuotaDates)
		dataRoute.GET("/flow", middleware.AdminAuth(), controller.GetAllFlowQuotaDates)
		dataRoute.GET("/flow/self", middleware.UserAuth(), controller.GetUserFlowQuotaDates)

		operationsStatsRoute := apiRouter.Group("/operations_stats")
		operationsStatsRoute.Use(middleware.AdminAuth())
		{
			operationsStatsRoute.GET("/overview", controller.GetOperationsOverview)
			operationsStatsRoute.GET("/trends", controller.GetOperationsTrends)
			operationsStatsRoute.GET("/distributions", controller.GetOperationsDistributions)
			operationsStatsRoute.GET("/rankings", controller.GetOperationsRankings)
		}

		ipAnalysisRoute := apiRouter.Group("/ip_analysis")
		ipAnalysisRoute.Use(middleware.RootAuth())
		{
			ipAnalysisRoute.GET("/rank/users", controller.GetIpAnalysisUserRank)
			ipAnalysisRoute.GET("/rank/ips", controller.GetIpAnalysisIpRank)
			ipAnalysisRoute.GET("/user/:user_id", controller.GetIpAnalysisUserDetail)
			ipAnalysisRoute.GET("/ip", controller.GetIpAnalysisIpDetail)
			ipAnalysisRoute.GET("/overview", controller.GetIpAnalysisOverview)
			ipAnalysisRoute.GET("/trend", controller.GetIpAnalysisTrend)
			ipAnalysisRoute.GET("/overlap", controller.GetIpAnalysisOverlap)
		}

		// 离线归属地库：状态与"立即更新"给管理员（其它管理员也能点），改配置仅 Root
		ipGeoRoute := apiRouter.Group("/ip_geo")
		{
			ipGeoRoute.GET("/status", middleware.AdminAuth(), controller.GetIpGeoStatus)
			ipGeoRoute.POST("/update", middleware.AdminAuth(), controller.UpdateIpGeoDatabase)
			ipGeoRoute.PUT("/config", middleware.RootAuth(), controller.UpdateIpGeoConfig)
		}

		logRoute.Use(middleware.CORS(), middleware.CriticalRateLimit())
		{
			logRoute.GET("/token", middleware.TokenAuthReadOnly(), controller.GetLogByKey)
		}
		groupRoute := apiRouter.Group("/group")
		groupRoute.Use(middleware.AdminAuth())
		{
			// 前端请求 /api/group（无尾斜杠），gin 不会自动重定向到 /api/group/，
			// 两个都注册避免 404。
			groupRoute.GET("", controller.GetGroups)
			groupRoute.GET("/", controller.GetGroups)
		}

		prefillGroupRoute := apiRouter.Group("/prefill_group")
		prefillGroupRoute.Use(middleware.AdminAuth())
		{
			prefillGroupRoute.GET("/", controller.GetPrefillGroups)
			prefillGroupRoute.POST("/", controller.CreatePrefillGroup)
			prefillGroupRoute.PUT("/", controller.UpdatePrefillGroup)
			prefillGroupRoute.DELETE("/:id", controller.DeletePrefillGroup)
		}

		mjRoute := apiRouter.Group("/mj")
		mjRoute.GET("/self", middleware.UserAuth(), controller.GetUserMidjourney)
		mjRoute.GET("/", middleware.AdminAuth(), controller.GetAllMidjourney)

		taskRoute := apiRouter.Group("/task")
		{
			taskRoute.GET("/self", middleware.UserAuth(), controller.GetUserTask)
			taskRoute.GET("", middleware.AdminAuth(), controller.GetAllTask)
			taskRoute.GET("/:task_id/artifacts", middleware.UserAuth(), controller.GetDashboardTaskArtifacts)
		}

		vendorRoute := apiRouter.Group("/vendors")
		vendorRoute.Use(middleware.AdminAuth())
		{
			vendorRoute.POST("/operations/preview", controller.PreviewVendorOperation)
			vendorRoute.POST("/operations", controller.ApplyVendorOperation)
			vendorRoute.GET("/", controller.GetAllVendors)
			vendorRoute.GET("/search", controller.SearchVendors)
			vendorRoute.GET("/:id", controller.GetVendorMeta)
			vendorRoute.POST("/", controller.CreateVendorMeta)
			vendorRoute.PUT("/", controller.UpdateVendorMeta)
			vendorRoute.DELETE("/:id", controller.DeleteVendorMeta)
		}

		modelsRoute := apiRouter.Group("/models")
		modelsRoute.Use(middleware.AdminAuth())
		{
			modelsRoute.GET("/sync_upstream/preview", controller.SyncUpstreamPreview)
			modelsRoute.POST("/sync_upstream", controller.SyncUpstreamModels)
			modelsRoute.POST("/delete", controller.BatchDeleteModelMeta)
			modelsRoute.GET("/missing", controller.GetMissingModels)
			modelsRoute.GET("/", controller.GetAllModelsMeta)
			modelsRoute.GET("/search", controller.SearchModelsMeta)
			modelsRoute.GET("/:id", controller.GetModelMeta)
			modelsRoute.POST("/", controller.CreateModelMeta)
			modelsRoute.PUT("/", controller.UpdateModelMeta)
			modelsRoute.DELETE("/:id", controller.DeleteModelMeta)
		}
	}
}
