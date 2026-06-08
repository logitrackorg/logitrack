package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
)

const encPrefix = "enc:"

// KeyFromEnv reads the env var and derives a 32-byte AES-256 key via SHA-256.
// Returns an empty slice if the env var is not set.
func KeyFromEnv(envVar string) []byte {
	raw := os.Getenv(envVar)
	if raw == "" {
		return nil
	}
	sum := sha256.Sum256([]byte(raw))
	return sum[:]
}

// Encrypt encrypts plaintext with AES-256-GCM using key and returns "enc:<base64(nonce|ciphertext)>".
// Returns the original plaintext unchanged if key is nil (dev mode without env var).
func Encrypt(plaintext string, key []byte) string {
	if len(key) == 0 {
		log.Println("[crypto] PAYMENT_SECRET_KEY no configurada — credencial guardada sin cifrar")
		return plaintext
	}
	if plaintext == "" {
		return ""
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		log.Printf("[crypto] error al crear cipher: %v", err)
		return plaintext
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		log.Printf("[crypto] error al crear GCM: %v", err)
		return plaintext
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		log.Printf("[crypto] error al generar nonce: %v", err)
		return plaintext
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return encPrefix + base64.StdEncoding.EncodeToString(ciphertext)
}

// Decrypt reverses Encrypt. If the value does not have the "enc:" prefix it is returned
// as-is (plain text stored before encryption was enabled).
func Decrypt(stored string, key []byte) (string, error) {
	if !strings.HasPrefix(stored, encPrefix) {
		return stored, nil // plain text — no key or stored before encryption was enabled
	}
	if len(key) == 0 {
		// Key missing but value is encrypted — cannot read.
		return "", fmt.Errorf("PAYMENT_SECRET_KEY no configurada pero la credencial está cifrada")
	}

	data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(stored, encPrefix))
	if err != nil {
		return "", fmt.Errorf("base64 inválido: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", fmt.Errorf("ciphertext demasiado corto")
	}
	nonce, ciphertext := data[:nonceSize], data[nonceSize:]

	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("error al descifrar: %w", err)
	}
	return string(plaintext), nil
}
