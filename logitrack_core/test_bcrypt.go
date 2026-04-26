package main

import (
	"fmt"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	// Test hash from database for gerente user
	hash := "$2a$10$xAqQYs/RPVOz5GjVt9/FFueHOXo4kzMcBODUynY40P5xo411vNFKi"
	password := "gerente123"

	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	fmt.Printf("Hash: %s\n", hash)
	fmt.Printf("Password: %s\n", password)
	fmt.Printf("Match: %v\n", err == nil)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	}
}
