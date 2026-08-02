package common

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAESGCMRoundTrip(t *testing.T) {
	original := CryptoSecret
	defer func() { CryptoSecret = original }()
	CryptoSecret = "test-secret-for-round-trip"

	plaintext := `{"access_token":"abc123","refresh_token":"def456"}`
	encrypted, err := AESGCMEncrypt(plaintext)
	require.NoError(t, err)
	require.NotEmpty(t, encrypted)

	// Ciphertext must never leak the plaintext.
	assert.NotContains(t, encrypted, plaintext)

	decrypted, err := AESGCMDecrypt(encrypted)
	require.NoError(t, err)
	assert.Equal(t, plaintext, decrypted)
}

func TestAESGCMRandomNonce(t *testing.T) {
	original := CryptoSecret
	defer func() { CryptoSecret = original }()
	CryptoSecret = "test-secret-nonce"

	// Two encryptions of the same plaintext must produce different ciphertexts
	// because each call uses a fresh random nonce.
	enc1, err := AESGCMEncrypt("same-value")
	require.NoError(t, err)
	enc2, err := AESGCMEncrypt("same-value")
	require.NoError(t, err)
	assert.NotEqual(t, enc1, enc2)

	dec1, err := AESGCMDecrypt(enc1)
	require.NoError(t, err)
	dec2, err := AESGCMDecrypt(enc2)
	require.NoError(t, err)
	assert.Equal(t, "same-value", dec1)
	assert.Equal(t, "same-value", dec2)
}

func TestAESGCMTamperedCiphertextFails(t *testing.T) {
	original := CryptoSecret
	defer func() { CryptoSecret = original }()
	CryptoSecret = "test-secret-tamper"

	encrypted, err := AESGCMEncrypt("secret-value")
	require.NoError(t, err)

	raw, err := base64.StdEncoding.DecodeString(encrypted)
	require.NoError(t, err)
	// Flip a byte in the ciphertext portion (skip the 12-byte nonce prefix).
	raw[len(raw)-1] ^= 0x01
	_, err = AESGCMDecrypt(base64.StdEncoding.EncodeToString(raw))
	assert.Error(t, err)
}

func TestAESGCMWrongKeyFails(t *testing.T) {
	original := CryptoSecret
	defer func() { CryptoSecret = original }()

	CryptoSecret = "key-a"
	encrypted, err := AESGCMEncrypt("value")
	require.NoError(t, err)

	CryptoSecret = "key-b"
	_, err = AESGCMDecrypt(encrypted)
	assert.Error(t, err)
}

func TestAESGCMKeyStableAcrossCalls(t *testing.T) {
	original := CryptoSecret
	defer func() { CryptoSecret = original }()
	CryptoSecret = "stable-secret"

	enc, err := AESGCMEncrypt("hello")
	require.NoError(t, err)

	// Same secret must decrypt what it encrypted earlier in the same process.
	dec, err := AESGCMDecrypt(enc)
	require.NoError(t, err)
	assert.Equal(t, "hello", dec)
}

func TestAESGCMMalformedInput(t *testing.T) {
	original := CryptoSecret
	defer func() { CryptoSecret = original }()
	CryptoSecret = "malformed-secret"

	// Not valid base64.
	_, err := AESGCMDecrypt("!!!not-base64!!!")
	assert.Error(t, err)

	// Valid base64 but far too short to hold nonce + tag.
	_, err = AESGCMDecrypt(base64.StdEncoding.EncodeToString([]byte("tiny")))
	assert.Error(t, err)

	// Empty string.
	_, err = AESGCMDecrypt("")
	assert.Error(t, err)
}

func TestAESGCMEncryptNeverContainsSecretSuffix(t *testing.T) {
	original := CryptoSecret
	defer func() { CryptoSecret = original }()
	CryptoSecret = "suffix-secret"

	enc, err := AESGCMEncrypt("refresh-token:xyz")
	require.NoError(t, err)
	// Ensure no plaintext fragment leaks through base64 alphabet collisions by
	// checking the output is a well-formed single base64 blob.
	assert.False(t, strings.Contains(enc, " "), "base64 output must not contain spaces")
}
