package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"strings"
)

const v2Prefix = "v2:"

func Encrypt(value, keyMaterial string) (string, error) {
	keyMaterial = strings.TrimSpace(keyMaterial)
	if keyMaterial == "" {
		return xorEncode(value), nil
	}
	block, err := aes.NewCipher(deriveKey(keyMaterial))
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	cipherText := gcm.Seal(nil, nonce, []byte(value), nil)
	payload := append(nonce, cipherText...)
	return v2Prefix + base64.StdEncoding.EncodeToString(payload), nil
}

func Decrypt(cipherText, keyMaterial string) (string, error) {
	cipherText = strings.TrimSpace(cipherText)
	if strings.HasPrefix(cipherText, v2Prefix) {
		keyMaterial = strings.TrimSpace(keyMaterial)
		if keyMaterial == "" {
			return "", fmt.Errorf("secret encryption key is required to decrypt v2 secrets")
		}
		raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(cipherText, v2Prefix))
		if err != nil {
			return "", err
		}
		block, err := aes.NewCipher(deriveKey(keyMaterial))
		if err != nil {
			return "", err
		}
		gcm, err := cipher.NewGCM(block)
		if err != nil {
			return "", err
		}
		if len(raw) < gcm.NonceSize() {
			return "", fmt.Errorf("invalid encrypted payload")
		}
		nonce := raw[:gcm.NonceSize()]
		enc := raw[gcm.NonceSize():]
		plain, err := gcm.Open(nil, nonce, enc, nil)
		if err != nil {
			return "", err
		}
		return string(plain), nil
	}
	return xorDecode(cipherText), nil
}

func deriveKey(keyMaterial string) []byte {
	hash := sha256.Sum256([]byte(keyMaterial))
	return hash[:]
}

func xorEncode(value string) string {
	encoded := make([]byte, len(value))
	key := byte(0x5A)
	for i := range value {
		encoded[i] = value[i] ^ key
	}
	return fmt.Sprintf("%x", encoded)
}

func xorDecode(cipherText string) string {
	raw, err := hex.DecodeString(cipherText)
	if err != nil {
		return ""
	}
	key := byte(0x5A)
	decoded := make([]byte, len(raw))
	for i := range raw {
		decoded[i] = raw[i] ^ key
	}
	return string(decoded)
}
