package repository

import (
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestHashPassword_ProducesBcryptHash(t *testing.T) {
	plain := "juan"
	hash, err := hashPassword(plain)
	if err != nil {
		t.Fatalf("hashPassword returned error: %v", err)
	}
	if hash == plain {
		t.Fatal("hashPassword returned plain text instead of a hash")
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)); err != nil {
		t.Fatalf("stored hash does not match original password: %v", err)
	}
}

func TestHashPassword_DifferentCallsProduceDifferentHashes(t *testing.T) {
	hash1, _ := hashPassword("password")
	hash2, _ := hashPassword("password")
	if hash1 == hash2 {
		t.Fatal("hashPassword produced identical hashes for the same input (bcrypt salt should make them unique)")
	}
}

func TestHashPassword_WrongPasswordFails(t *testing.T) {
	hash, _ := hashPassword("correctPassword")
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte("wrongPassword")); err == nil {
		t.Fatal("expected mismatch for wrong password, but compare succeeded")
	}
}
