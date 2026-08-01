package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestShouldSyncOAuthAvatar(t *testing.T) {
	tests := []struct {
		name           string
		currentAvatar  string
		isCustom       bool
		providerAvatar string
		want           bool
	}{
		{
			name:           "empty provider avatar is a no-op",
			currentAvatar:  "",
			isCustom:       false,
			providerAvatar: "",
			want:           false,
		},
		{
			name:           "new user with provider avatar is synced",
			currentAvatar:  "",
			isCustom:       false,
			providerAvatar: "https://github.com/x.png",
			want:           true,
		},
		{
			name:           "user-uploaded avatar is never overwritten",
			currentAvatar:  "/uploads/avatar/1.png",
			isCustom:       true,
			providerAvatar: "https://github.com/x.png",
			want:           false,
		},
		{
			name:           "user-uploaded avatar with empty provider is a no-op",
			currentAvatar:  "/uploads/avatar/1.png",
			isCustom:       true,
			providerAvatar: "",
			want:           false,
		},
		{
			name:           "identical oauth avatar needs no write",
			currentAvatar:  "https://github.com/x.png",
			isCustom:       false,
			providerAvatar: "https://github.com/x.png",
			want:           false,
		},
		{
			name:           "changed oauth avatar is synced",
			currentAvatar:  "https://github.com/old.png",
			isCustom:       false,
			providerAvatar: "https://github.com/new.png",
			want:           true,
		},
		{
			name:           "oauth avatar removed by provider is kept",
			currentAvatar:  "https://github.com/x.png",
			isCustom:       false,
			providerAvatar: "",
			want:           false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldSyncOAuthAvatar(tt.currentAvatar, tt.isCustom, tt.providerAvatar)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestSyncOAuthAvatarPersistsOnlyOnChange(t *testing.T) {
	user := &User{
		Username: "avatar_sync_user",
		Status:   1,
		Group:    "default",
	}
	require.NoError(t, DB.Create(user).Error)

	// First sync persists the provider avatar.
	require.NoError(t, user.SyncOAuthAvatar("https://example.com/a.png"))
	require.Equal(t, "https://example.com/a.png", user.Avatar)

	var stored User
	require.NoError(t, DB.First(&stored, user.Id).Error)
	require.Equal(t, "https://example.com/a.png", stored.Avatar)
	require.False(t, stored.AvatarCustom)

	// Mark as custom; provider avatar must no longer overwrite it. In a real
	// login the user struct is freshly loaded from the DB, so the in-memory
	// AvatarCustom mirrors the stored value.
	require.NoError(t, DB.Model(&User{}).Where("id = ?", user.Id).Update("avatar_custom", true).Error)
	user.AvatarCustom = true
	require.NoError(t, user.SyncOAuthAvatar("https://example.com/b.png"))
	require.Equal(t, "https://example.com/a.png", user.Avatar)

	require.NoError(t, DB.Unscoped().Delete(&User{}, user.Id).Error)
}
