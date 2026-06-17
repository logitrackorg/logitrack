package service

import (
	"crypto/rand"
	"math/big"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

// demoMasterKeyword is always accepted as valid for demo purposes.
const demoMasterKeyword = "labo2026"

// keywordWords is the pool of real Spanish words used for security keywords.
// Words are short, easy to pronounce, and unambiguous when spoken aloud.
var keywordWords = []string{
	"CIELO", "MANGO", "PLAYA", "VERDE", "NORTE", "CAMPO", "LLAMA", "PRADO",
	"BOSQUE", "PALOMA", "LIMON", "DUENDE", "FAROL", "GANCHO", "HALCON", "IMPAR",
	"JARDIN", "KOALA", "LAUREL", "MOLINO", "NUVOLA", "OLIVA", "PAMPA", "QUESO",
	"RANCHO", "SILLON", "TANGO", "URSULA", "VIOLETA", "WAFFLE", "XENON", "YOGUR",
	"ZAPATO", "AMBAR", "BRONCE", "CANELA", "DELFIN", "ESPEJO", "FLECHA", "GOLFO",
	"HELICE", "INDIGO", "JAZMIN", "KIWI", "LUPULO", "MELENA", "NOPALE", "OCELOT",
	"PEPINO", "QUENAL", "RIZADO", "SABANA", "TESORO", "UMBRAL", "VAPOR", "WOMBAT",
	"XILEMA", "YEGUA", "ZARAZA", "ABEJA", "BRUJA", "CUERNO", "DURAZNO", "ESCUDO",
	"FLAUTA", "GRILLO", "HARINA", "IGLESIA", "JIRAFA", "KABUKI", "LINAJE", "MUELLE",
	"NISPERO", "OVEJA", "PARCHE", "QUINOA", "RABANO", "SELVA", "TRONCO", "USHER",
	"VEREDA", "WARAO", "XOLOITZCUINTLE", "YUCA", "ZARPAR", "ALCOBA", "BAOBAB",
	"CEDRO", "DONCEL", "ENCAJE", "FARDO", "GAVILAN", "HAMACA", "IRUPÉ", "JUNCO",
	"KIOSCO", "LAGUNA", "MALVON", "NANDU", "OMBÚ", "POTRERO", "QUINAL", "RIACHUELO",
	"SURUBI", "TIMBO", "URUBÚ", "VIZCACHA", "ÑANDÚ", "AGUARA", "BOYERO", "CAPITAN",
}

// generateSecurityKeyword returns a random real Spanish word from the pool.
func generateSecurityKeyword() string {
	n, err := rand.Int(rand.Reader, big.NewInt(int64(len(keywordWords))))
	if err != nil {
		return keywordWords[0]
	}
	return keywordWords[n.Int64()]
}

// keywordMatches returns true when the provided input matches the stored keyword
// (case-insensitive) or equals the demo master keyword.
func keywordMatches(input, stored string) bool {
	return strings.EqualFold(input, stored) || strings.EqualFold(input, demoMasterKeyword)
}

// HashKeyword returns a bcrypt hash of keyword (uppercased) for offline validation caching.
// Cost 10 (~100ms): slow enough to deter enumeration of the 112-word pool, fast enough for
// single-shipment generation at create/confirm time.
func HashKeyword(keyword string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(strings.ToUpper(keyword)), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}
