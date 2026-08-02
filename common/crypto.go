package common

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"

	"golang.org/x/crypto/bcrypt"
)

func GenerateHMACWithKey(key []byte, data string) string {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(data))
	return hex.EncodeToString(h.Sum(nil))
}

func GenerateHMAC(data string) string {
	h := hmac.New(sha256.New, []byte(CryptoSecret))
	h.Write([]byte(data))
	return hex.EncodeToString(h.Sum(nil))
}

// aesGCMKey derives a 32-byte AES key from CryptoSecret. CryptoSecret is a UUID
// (36 bytes, not a valid AES key length), so it is stretched through SHA-256.
func aesGCMKey() []byte {
	sum := sha256.Sum256([]byte(CryptoSecret))
	return sum[:]
}

// AESGCMEncrypt encrypts plaintext with AES-256-GCM using CryptoSecret as the
// key source. A fresh random 12-byte nonce is used per call; the output is
// base64(nonce || ciphertext). Requires CRYPTO_SECRET to be set for the cipher
// to survive a process restart.
func AESGCMEncrypt(plaintext string) (string, error) {
	block, err := aes.NewCipher(aesGCMKey())
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// AESGCMDecrypt reverses AESGCMEncrypt. It fails on a tampered ciphertext, a
// wrong key, or a malformed base64 payload.
func AESGCMDecrypt(encrypted string) (string, error) {
	sealed, err := base64.StdEncoding.DecodeString(encrypted)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(aesGCMKey())
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonceSize := gcm.NonceSize()
	if len(sealed) < nonceSize {
		return "", errors.New("ciphertext too short")
	}
	nonce, ciphertext := sealed[:nonceSize], sealed[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

func Password2Hash(password string) (string, error) {
	passwordBytes := []byte(password)
	hashedPassword, err := bcrypt.GenerateFromPassword(passwordBytes, bcrypt.DefaultCost)
	return string(hashedPassword), err
}

func ValidatePasswordAndHash(password string, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}
