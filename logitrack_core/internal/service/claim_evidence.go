package service

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
)

// MaxClaimEvidenceSize es el tamaño máximo permitido para una evidencia
// adjunta. Centralizado acá para que el servicio sea la única fuente de
// verdad — los handlers no deben validar tamaño por su cuenta.
const MaxClaimEvidenceSize int64 = 1 << 20 // 1 MB

// AllowedClaimEvidenceExtensions enumera las extensiones de archivo aceptadas
// para evidencias de reclamo. Aplicable a AMBOS canales (chatbot y formulario
// público). Si se agrega .doc/.docx u otro formato a futuro, hay que
// reflejarlo también en logitrack_web/src/utils/claimDecisionTree.ts (helper
// `isAllowedClaimEvidenceFile`) y en ChatInput.tsx (atributo `accept`).
var AllowedClaimEvidenceExtensions = []string{".pdf", ".txt"}

// IsAllowedClaimEvidence valida si el archivo (por nombre + MIME) entra en el
// set único de tipos permitidos: imágenes (cualquier subtipo) + PDF + TXT.
func IsAllowedClaimEvidence(filename, mimeType string) bool {
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	if strings.HasPrefix(mimeType, "image/") {
		return true
	}
	ext := strings.ToLower(filepath.Ext(filename))
	for _, allowed := range AllowedClaimEvidenceExtensions {
		if ext == allowed {
			return true
		}
	}
	// Algunos clientes mandan los MIME canónicos sin extensión; los aceptamos.
	if mimeType == "application/pdf" || mimeType == "text/plain" {
		return true
	}
	return false
}

// validateEvidenceUpload aplica reglas comunes de tamaño/tipo a un upload ya
// parseado. Es el único lugar donde se chequea esto: los parsers de los
// handlers se limitan a traducir el multipart/form-data a un
// ClaimEvidenceUpload y delegan acá.
func validateEvidenceUpload(evidence *ClaimEvidenceUpload) error {
	if evidence == nil {
		return nil
	}
	if int64(len(evidence.Data)) > MaxClaimEvidenceSize {
		return fmt.Errorf("la evidencia debe pesar como maximo 1 MB")
	}
	if !IsAllowedClaimEvidence(evidence.FileName, evidence.MimeType) {
		return fmt.Errorf("la evidencia debe ser un archivo .txt, .pdf o una imagen")
	}
	return nil
}

// ActiveClaimExistsError indica que el mismo reclamante ya tiene un reclamo
// activo (no resuelto) para el envío. Los handlers lo detectan vía
// errors.As() y responden con HTTP 409 + claim_id + status del reclamo
// existente.
type ActiveClaimExistsError struct {
	ExistingClaimID string
	ExistingStatus  string
}

func (e *ActiveClaimExistsError) Error() string {
	return fmt.Sprintf("Ya tenés un reclamo abierto (%s) en estado '%s'. No podés abrir otro hasta que se resuelva.", e.ExistingClaimID, e.ExistingStatus)
}

// IsActiveClaimExistsError es un helper para los handlers que prefieran
// errors.Is/errors.As; equivale a errors.As(err, &target).
func IsActiveClaimExistsError(err error) (*ActiveClaimExistsError, bool) {
	var target *ActiveClaimExistsError
	if errors.As(err, &target) {
		return target, true
	}
	return nil, false
}
