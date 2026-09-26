// @muw-owned
package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// OIDC Provider 的持久层查询。约定：
//   - 令牌（授权码 / 刷新令牌）只存哈希，查询按哈希命中；
//   - "一次性"语义用条件 UPDATE 的 RowsAffected 判定，不靠读后写（并发下读后写会双放行）。

func CreateOIDCClient(client *OIDCClient) error { return DB.Create(client).Error }

func GetOIDCClientByClientId(clientId string) (*OIDCClient, error) {
	var client OIDCClient
	err := DB.Where("client_id = ?", clientId).First(&client).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrOIDCClientNotFound
	}
	if err != nil {
		return nil, err
	}
	return &client, nil
}

func GetOIDCClientById(id int) (*OIDCClient, error) {
	var client OIDCClient
	err := DB.Where("id = ?", id).First(&client).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrOIDCClientNotFound
	}
	if err != nil {
		return nil, err
	}
	return &client, nil
}

func ListOIDCClients(status string, offset, limit int) ([]*OIDCClient, int64, error) {
	query := DB.Model(&OIDCClient{})
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var clients []*OIDCClient
	err := query.Order("id DESC").Offset(offset).Limit(limit).Find(&clients).Error
	return clients, total, err
}

func ListOIDCClientsByOwner(userId int) ([]*OIDCClient, error) {
	var clients []*OIDCClient
	err := DB.Where("owner_user_id = ?", userId).Order("id DESC").Find(&clients).Error
	return clients, err
}

// ListOIDCClientsByClientIds 批量取应用（明细/聚合展示应用名用）。
func ListOIDCClientsByClientIds(clientIds []string) ([]*OIDCClient, error) {
	if len(clientIds) == 0 {
		return nil, nil
	}
	var clients []*OIDCClient
	err := DB.Where("client_id IN ?", clientIds).Find(&clients).Error
	return clients, err
}

// CountOIDCClientsByOwner 返回该用户的应用总数与待审核数（申请配额用）。
func CountOIDCClientsByOwner(userId int) (total int64, pending int64, err error) {
	if err = DB.Model(&OIDCClient{}).Where("owner_user_id = ?", userId).Count(&total).Error; err != nil {
		return 0, 0, err
	}
	if err = DB.Model(&OIDCClient{}).Where("owner_user_id = ? AND status = ?", userId, OIDCClientStatusPending).Count(&pending).Error; err != nil {
		return 0, 0, err
	}
	return total, pending, nil
}

func UpdateOIDCClientFields(id int, fields map[string]any) error {
	if len(fields) == 0 {
		return nil
	}
	return DB.Model(&OIDCClient{}).Where("id = ?", id).Updates(fields).Error
}

func DeleteOIDCClientById(id int) error { return DB.Delete(&OIDCClient{}, id).Error }

// TouchOIDCClientLastUsed 记录应用最近一次成功换取令牌的时间（管理页展示）。
func TouchOIDCClientLastUsed(clientId string) error {
	return DB.Model(&OIDCClient{}).Where("client_id = ?", clientId).
		Update("last_used_at", common.GetTimestamp()).Error
}

func CreateOIDCAuthCode(code *OIDCAuthCode) error { return DB.Create(code).Error }

// ConsumeOIDCAuthCode 原子地消费授权码：只有"未使用"的行能被标记，重复出示（重放）
// 或已过期的码一律失败。
func ConsumeOIDCAuthCode(codeHash string, now int64) (*OIDCAuthCode, error) {
	result := DB.Model(&OIDCAuthCode{}).
		Where("code_hash = ? AND used_at = 0 AND expires_at > ?", codeHash, now).
		Update("used_at", now)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, errors.New("授权码无效、已过期或已被使用")
	}
	var code OIDCAuthCode
	if err := DB.Where("code_hash = ?", codeHash).First(&code).Error; err != nil {
		return nil, err
	}
	return &code, nil
}

func CreateOIDCRefreshToken(token *OIDCRefreshToken) error { return DB.Create(token).Error }

func GetOIDCRefreshTokenByHash(tokenHash string) (*OIDCRefreshToken, error) {
	var token OIDCRefreshToken
	err := DB.Where("token_hash = ?", tokenHash).First(&token).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &token, nil
}

// GetOIDCRefreshTokenByPreviousHash 命中说明旧令牌被重复出示（重放），调用方应撤销整条链。
func GetOIDCRefreshTokenByPreviousHash(previousHash string) (*OIDCRefreshToken, error) {
	var token OIDCRefreshToken
	err := DB.Where("previous_hash = ?", previousHash).First(&token).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &token, nil
}

// RotateOIDCRefreshToken 轮换：旧哈希挪到 previous_*，新哈希上位。条件带 revoked_at = 0，
// 保证已撤销的令牌不会被"复活"。
func RotateOIDCRefreshToken(id int, newHash, oldHash string, previousValidUntil, expiresAt int64) error {
	result := DB.Model(&OIDCRefreshToken{}).
		Where("id = ? AND revoked_at = 0", id).
		Updates(map[string]any{
			"token_hash":           newHash,
			"previous_hash":        oldHash,
			"previous_valid_until": previousValidUntil,
			"expires_at":           expiresAt,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("刷新令牌已失效")
	}
	return nil
}

func RevokeOIDCRefreshTokenById(id int, now int64) error {
	return DB.Model(&OIDCRefreshToken{}).Where("id = ?", id).Update("revoked_at", now).Error
}

func RevokeOIDCRefreshTokensByUserClient(userId int, clientId string, now int64) error {
	return DB.Model(&OIDCRefreshToken{}).
		Where("user_id = ? AND client_id = ? AND revoked_at = 0", userId, clientId).
		Update("revoked_at", now).Error
}

// RevokeOIDCRefreshTokensByClient 撤销某个应用的全部刷新令牌（不限用户）：
// 管理员禁用/删除应用时用。不要用 RevokeOIDCRefreshTokensByUserClient(0, …) 代替 ——
// userId=0 会落到 `user_id = 0`，而真实令牌的 user_id 恒大于 0，等于什么都没撤。
func RevokeOIDCRefreshTokensByClient(clientId string, now int64) error {
	return DB.Model(&OIDCRefreshToken{}).
		Where("client_id = ? AND revoked_at = 0", clientId).
		Update("revoked_at", now).Error
}

func RevokeOIDCRefreshTokensByUser(userId int, now int64) error {
	return DB.Model(&OIDCRefreshToken{}).
		Where("user_id = ? AND revoked_at = 0", userId).Update("revoked_at", now).Error
}

func GetOIDCConsent(userId int, clientId string) (*OIDCConsent, error) {
	var consent OIDCConsent
	err := DB.Where("user_id = ? AND client_id = ?", userId, clientId).First(&consent).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &consent, nil
}

func ListOIDCConsentsByUser(userId int) ([]*OIDCConsent, error) {
	var consents []*OIDCConsent
	err := DB.Where("user_id = ?", userId).Order("id DESC").Find(&consents).Error
	return consents, err
}

// UpsertOIDCConsent 先查后写（同一用户对同一应用只有一行，复合唯一索引兜底并发）。
func UpsertOIDCConsent(userId int, clientId, scopes string) error {
	now := common.GetTimestamp()
	consent, err := GetOIDCConsent(userId, clientId)
	if err != nil {
		return err
	}
	if consent == nil {
		return DB.Create(&OIDCConsent{UserId: userId, ClientId: clientId, Scopes: scopes, CreatedAt: now, UpdatedAt: now}).Error
	}
	return DB.Model(&OIDCConsent{}).Where("id = ?", consent.Id).
		Updates(map[string]any{"scopes": scopes, "updated_at": now}).Error
}

func DeleteOIDCConsent(userId int, clientId string) error {
	return DB.Where("user_id = ? AND client_id = ?", userId, clientId).Delete(&OIDCConsent{}).Error
}

func DeleteOIDCConsentsByClient(clientId string) error {
	return DB.Where("client_id = ?", clientId).Delete(&OIDCConsent{}).Error
}

func GetActiveOIDCSigningKey() (*OIDCSigningKey, error) {
	var key OIDCSigningKey
	err := DB.Where("status = ?", OIDCSigningKeyStatusActive).Order("id DESC").First(&key).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &key, nil
}

// ListLiveOIDCSigningKeys 返回仍要出现在 JWKS 里的密钥：当前签名密钥 + 未超过
// 宽限期的退役密钥（让已签发的 id_token 在有效期内始终可验证）。
func ListLiveOIDCSigningKeys(retiredAfter int64) ([]*OIDCSigningKey, error) {
	var keys []*OIDCSigningKey
	err := DB.Where("status = ? OR (status = ? AND retired_at >= ?)",
		OIDCSigningKeyStatusActive, OIDCSigningKeyStatusRetired, retiredAfter).
		Order("id DESC").Find(&keys).Error
	return keys, err
}

// CreateOIDCSigningKey 落一枚新签名密钥并退役旧的（同一事务，只碰 tx 句柄）。
func CreateOIDCSigningKey(key *OIDCSigningKey, now int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&OIDCSigningKey{}).Where("status = ?", OIDCSigningKeyStatusActive).
			Updates(map[string]any{"status": OIDCSigningKeyStatusRetired, "retired_at": now}).Error; err != nil {
			return err
		}
		key.Status = OIDCSigningKeyStatusActive
		key.CreatedAt = now
		return tx.Create(key).Error
	})
}
