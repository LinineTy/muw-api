// @muw-owned
package service

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"math/big"
	"net"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/golang-jwt/jwt/v5"
)

// OIDC Provider 的签名密钥与 id_token 签发。
//
// issuer 取站点对外地址（ServerAddress）——它是身份键（issuer + sub）的一半，
// 所以宁可报错也不静默兜底。私钥只以 AES-GCM 密文落库，内存里缓存一份
// （进程重启后重新解密），公钥由私钥推导、不单独存。
const (
	oidcSigningAlg      = "RS256"
	oidcSigningKeyBits  = 2048
	OIDCIDTokenTTL      = 10 * time.Minute
	oidcRetiredKeyGrace = 2 * time.Hour
)

var (
	ErrOIDCIssuerInvalid = errors.New("OIDC 需要把站点地址（ServerAddress）配置为 https 地址（本机部署可填 http://localhost 或 http://<私网IP>）")

	oidcSigningMu sync.RWMutex
	oidcKeyCache  *oidcSigningMaterial
)

type oidcSigningMaterial struct {
	kid     string
	private *rsa.PrivateKey
}

// OIDCIssuer 返回 issuer（去尾斜杠）。仅本机调试允许 http。
func OIDCIssuer() (string, error) {
	issuer := strings.TrimRight(strings.TrimSpace(system_setting.ServerAddress), "/")
	if issuer == "" {
		return "", ErrOIDCIssuerInvalid
	}
	if !strings.HasPrefix(issuer, "https://") && !isLocalOrigin(issuer) {
		return "", ErrOIDCIssuerInvalid
	}
	return issuer, nil
}

// isLocalOrigin 判断来源是否"本地或内网"：回环、私网 IPv4、或 localhost 主机名。
// 公网地址一律要求 https（OIDC 规范如此）；这里只给本机部署留口子——
// 否则在内网用 http://<私网IP> 起来时，issuer 与回调地址校验会把整条流程拦死。
func isLocalOrigin(origin string) bool {
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		return false
	}
	host := parsed.Hostname()
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate()
}

func oidcRandomToken(byteLen int) (string, error) {
	buf := make([]byte, byteLen)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// oidcSigningKey 返回当前签名密钥，没有就现场生成一枚（首次调用时落库）。
func oidcSigningKey() (*oidcSigningMaterial, error) {
	oidcSigningMu.RLock()
	cached := oidcKeyCache
	oidcSigningMu.RUnlock()
	if cached != nil {
		return cached, nil
	}

	oidcSigningMu.Lock()
	defer oidcSigningMu.Unlock()
	if oidcKeyCache != nil {
		return oidcKeyCache, nil
	}
	stored, err := model.GetActiveOIDCSigningKey()
	if err != nil {
		return nil, err
	}
	if stored == nil {
		if stored, err = oidcCreateSigningKey(); err != nil {
			return nil, err
		}
	}
	material, err := oidcDecodeSigningKey(stored)
	if err != nil {
		return nil, err
	}
	oidcKeyCache = material
	return material, nil
}

func oidcCreateSigningKey() (*model.OIDCSigningKey, error) {
	private, err := rsa.GenerateKey(rand.Reader, oidcSigningKeyBits)
	if err != nil {
		return nil, err
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(private)})
	cipherText, err := common.AESGCMEncrypt(string(pemBytes))
	if err != nil {
		return nil, err
	}
	kid, err := oidcRandomToken(12)
	if err != nil {
		return nil, err
	}
	key := &model.OIDCSigningKey{Kid: kid, Alg: oidcSigningAlg, PrivateKeyCipher: cipherText}
	if err := model.CreateOIDCSigningKey(key, common.GetTimestamp()); err != nil {
		return nil, err
	}
	return key, nil
}

func oidcDecodeSigningKey(stored *model.OIDCSigningKey) (*oidcSigningMaterial, error) {
	plain, err := common.AESGCMDecrypt(stored.PrivateKeyCipher)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode([]byte(plain))
	if block == nil {
		return nil, errors.New("OIDC 签名密钥无法解析")
	}
	private, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	return &oidcSigningMaterial{kid: stored.Kid, private: private}, nil
}

type oidcJWK struct {
	Kty string `json:"kty"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	Kid string `json:"kid"`
	N   string `json:"n"`
	E   string `json:"e"`
}

// OIDCJWKS 返回公钥集：当前签名密钥 + 宽限期内的退役密钥（保证已签发的 id_token
// 在整个有效期内都能验签）。
func OIDCJWKS() (map[string]any, error) {
	if _, err := oidcSigningKey(); err != nil {
		return nil, err
	}
	keys, err := model.ListLiveOIDCSigningKeys(common.GetTimestamp() - int64(oidcRetiredKeyGrace.Seconds()))
	if err != nil {
		return nil, err
	}
	out := make([]oidcJWK, 0, len(keys))
	for _, stored := range keys {
		material, err := oidcDecodeSigningKey(stored)
		if err != nil {
			// 解不开的历史密钥不该拖垮 JWKS，跳过它。
			common.SysLog("oidc: skip unreadable signing key " + stored.Kid)
			continue
		}
		out = append(out, oidcPublicJWK(material))
	}
	return map[string]any{"keys": out}, nil
}

func oidcPublicJWK(material *oidcSigningMaterial) oidcJWK {
	public := material.private.Public().(*rsa.PublicKey)
	return oidcJWK{
		Kty: "RSA",
		Use: "sig",
		Alg: oidcSigningAlg,
		Kid: material.kid,
		N:   base64.RawURLEncoding.EncodeToString(public.N.Bytes()),
		E:   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(public.E)).Bytes()),
	}
}

// oidcIDTokenClaims 是 id_token 的载荷。身份相关字段按 scope 裁剪：
// 只申请 openid 时只有 sub/aud/exp 这些协议必需项。
type oidcIDTokenClaims struct {
	Nonce             string `json:"nonce,omitempty"`
	AuthTime          int64  `json:"auth_time,omitempty"`
	PreferredUsername string `json:"preferred_username,omitempty"`
	Name              string `json:"name,omitempty"`
	Picture           string `json:"picture,omitempty"`
	Email             string `json:"email,omitempty"`
	EmailVerified     *bool  `json:"email_verified,omitempty"`
	Group             string `json:"group,omitempty"`
	jwt.RegisteredClaims
}

func oidcSignIDToken(claims oidcIDTokenClaims) (string, error) {
	material, err := oidcSigningKey()
	if err != nil {
		return "", err
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = material.kid
	return token.SignedString(material.private)
}

// ResetOIDCSigningKeyCacheForTest 清掉进程内的签名密钥缓存。
// 测试里每个用例会换到自己的库，缓存中的 kid 属于上一个库，会让 JWKS 与 id_token 对不上。
func ResetOIDCSigningKeyCacheForTest() {
	oidcSigningMu.Lock()
	oidcKeyCache = nil
	oidcSigningMu.Unlock()
}
