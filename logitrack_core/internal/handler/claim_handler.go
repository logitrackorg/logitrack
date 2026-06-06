package handler

import (
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/service"
)

type ClaimHandler struct {
	svc *service.ClaimService
}

func NewClaimHandler(svc *service.ClaimService) *ClaimHandler {
	return &ClaimHandler{svc: svc}
}

// ListClaims returns claims for the user's origin branch.
//
// @Summary      List claims
// @Description  Returns claims filtered to the user's origin branch. Operator and supervisor only.
// @Tags         claims
// @Produce      json
// @Security     BearerAuth
// @Success      200  {array}  model.Claim
// @Failure      401  {object}  map[string]string
// @Failure      403  {object}  map[string]string
// @Router       /claims [get]
func (h *ClaimHandler) ListClaims(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	// allow manager to pass optional branch_id query param; others are scoped to their branch
	branchID := strings.TrimSpace(c.Query("branch_id"))
	status := strings.TrimSpace(c.Query("status"))
	if user.Role != model.RoleManager {
		branchID = user.BranchID
	}
	claims, err := h.svc.ListByOriginBranch(branchID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// filter by status if provided
	if status != "" {
		filtered := make([]model.Claim, 0, len(claims))
		for _, c := range claims {
			if string(c.Status) == status {
				filtered = append(filtered, c)
			}
		}
		claims = filtered
	}
	if claims == nil {
		claims = []model.Claim{}
	}
	c.JSON(http.StatusOK, claims)
}

// GetClaim returns a claim by ID (branch-restricted).
//
// @Summary      Get claim
// @Description  Returns a claim by ID for the user's origin branch. Operator and supervisor only.
// @Tags         claims
// @Produce      json
// @Security     BearerAuth
// @Param        id   path      string  true  "Claim ID"
// @Success      200  {object}  model.Claim
// @Failure      401  {object}  map[string]string
// @Failure      403  {object}  map[string]string
// @Failure      404  {object}  map[string]string
// @Router       /claims/{id} [get]
func (h *ClaimHandler) GetClaim(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	claim, err := h.svc.GetByIDForBranch(c.Param("id"), user.BranchID)
	if err != nil {
		if err == repository.ErrClaimNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if err == service.ErrClaimForbidden {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, claim)
}

// UpdateClaimCategory derives a claim to a category.
//
// @Summary      Update claim category
// @Description  Updates the claim category and marks it as derived. Operator and supervisor only.
// @Tags         claims
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        id   path      string  true  "Claim ID"
// @Param        body body      model.UpdateClaimCategoryRequest true "Category data"
// @Success      200  {object}  model.Claim
// @Failure      400  {object}  map[string]string
// @Failure      403  {object}  map[string]string
// @Failure      404  {object}  map[string]string
// @Router       /claims/{id}/category [patch]
func (h *ClaimHandler) UpdateClaimCategory(c *gin.Context) {
	var req model.UpdateClaimCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user := c.MustGet(middleware.UserKey).(model.User)
	claim, err := h.svc.UpdateCategory(c.Param("id"), req.AssignedCategory, user.Username, user.BranchID, req.Notes)
	if err != nil {
		if err == repository.ErrClaimNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if err == service.ErrClaimForbidden {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, claim)
}

// ResolveClaim resolves a claim with a resolution type.
//
// @Summary      Resolve claim
// @Description  Resolves a claim with a resolution type. Operator and supervisor only.
// @Tags         claims
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        id   path      string  true  "Claim ID"
// @Param        body body      model.ResolveClaimRequest true "Resolution data"
// @Success      200  {object}  model.Claim
// @Failure      400  {object}  map[string]string
// @Failure      403  {object}  map[string]string
// @Failure      404  {object}  map[string]string
// @Router       /claims/{id}/resolve [post]
func (h *ClaimHandler) ResolveClaim(c *gin.Context) {
	var req model.ResolveClaimRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user := c.MustGet(middleware.UserKey).(model.User)
	claim, err := h.svc.Resolve(c.Param("id"), req.ResolutionType, user.Username, user.BranchID, req.Notes)
	if err != nil {
		if err == repository.ErrClaimNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if err == service.ErrClaimForbidden {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, claim)
}

// RequestCustomerInfo requests more information from the customer and sets status to pending_customer.
//
// @Summary      Request customer info
// @Description  Requests more information from the customer and marks claim as pending customer. Operator and supervisor only.
// @Tags         claims
// @Accept       json
// @Produce      json
// @Security     BearerAuth
// @Param        id   path      string  true  "Claim ID"
// @Param        body body      model.RequestCustomerInfoRequest true "Notes"
// @Success      200  {object}  model.Claim
// @Failure      400  {object}  map[string]string
// @Failure      403  {object}  map[string]string
// @Failure      404  {object}  map[string]string
// @Router       /claims/{id}/request-info [post]
func (h *ClaimHandler) RequestCustomerInfo(c *gin.Context) {
	var req model.RequestCustomerInfoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user := c.MustGet(middleware.UserKey).(model.User)
	claim, err := h.svc.RequestCustomerInfo(c.Param("id"), user.Username, user.BranchID, req.Notes)
	if err != nil {
		if err == repository.ErrClaimNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if err == service.ErrClaimForbidden {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, claim)
}

// MarkClaimInReview moves a claim from pending customer to in review.
//
// @Summary      Mark claim in review
// @Description  Moves a claim from pending customer back to review. Operator and supervisor only.
// @Tags         claims
// @Produce      json
// @Security     BearerAuth
// @Param        id   path      string  true  "Claim ID"
// @Success      200  {object}  model.Claim
// @Failure      400  {object}  map[string]string
// @Failure      403  {object}  map[string]string
// @Failure      404  {object}  map[string]string
// @Router       /claims/{id}/review [post]
func (h *ClaimHandler) MarkClaimInReview(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	claim, err := h.svc.MarkInReview(c.Param("id"), user.Username, user.BranchID)
	if err != nil {
		if err == repository.ErrClaimNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if err == service.ErrClaimForbidden {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, claim)
}

// GetClaimEvents returns the event history for a claim.
//
// @Summary      Get claim events
// @Description  Returns the event timeline for a claim. Operator and supervisor only.
// @Tags         claims
// @Produce      json
// @Security     BearerAuth
// @Param        id   path      string  true  "Claim ID"
// @Success      200  {array}   model.ClaimEvent
// @Failure      403  {object}  map[string]string
// @Failure      404  {object}  map[string]string
// @Router       /claims/{id}/events [get]
func (h *ClaimHandler) GetClaimEvents(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	events, err := h.svc.GetEvents(c.Param("id"), user.BranchID)
	if err != nil {
		if err == repository.ErrClaimNotFound || err == repository.ErrClaimEventStreamNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if err == service.ErrClaimForbidden {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if events == nil {
		events = []model.ClaimEvent{}
	}
	c.JSON(http.StatusOK, events)
}

// CreatePublicClaim creates a public claim without authentication.
//
// @Summary      Create public claim
// @Description  Creates a claim linked to a shipment. No authentication required.
// @Tags         public
// @Accept       json
// @Produce      json
// @Param        body  body      model.CreatePublicClaimRequest  true  "Claim data"
// @Success      201   {object}  model.Claim
// @Failure      400   {object}  map[string]string
// @Failure      404   {object}  map[string]string
// @Router       /public/claims [post]
func (h *ClaimHandler) CreatePublicClaim(c *gin.Context) {
	req, evidence, err := parsePublicClaimRequest(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	claim, err := h.svc.CreatePublicClaim(req, evidence)
	if err != nil {
		if err.Error() == "envio no encontrado" {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, claim)
}

func parsePublicClaimRequest(c *gin.Context) (model.CreatePublicClaimRequest, *service.ClaimEvidenceUpload, error) {
	if strings.Contains(c.GetHeader("Content-Type"), "multipart/form-data") {
		return parseMultipartPublicClaimRequest(c)
	}
	var req model.CreatePublicClaimRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		return model.CreatePublicClaimRequest{}, nil, err
	}
	return req, nil, nil
}

func parseMultipartPublicClaimRequest(c *gin.Context) (model.CreatePublicClaimRequest, *service.ClaimEvidenceUpload, error) {
	if err := c.Request.ParseMultipartForm(2 << 20); err != nil && !errors.Is(err, http.ErrNotMultipart) {
		return model.CreatePublicClaimRequest{}, nil, err
	}
	req := model.CreatePublicClaimRequest{
		TrackingID:  strings.TrimSpace(c.PostForm("tracking_id")),
		ClaimType:   model.ClaimType(strings.TrimSpace(c.PostForm("claim_type"))),
		Description: strings.TrimSpace(c.PostForm("description")),
		CreatedBy:   strings.TrimSpace(c.PostForm("created_by")),
		DNI:         strings.TrimSpace(c.PostForm("dni")),
	}
	damageSubtypes := splitCSV(strings.TrimSpace(c.PostForm("damage_subtypes")))
	fileHeader, err := c.FormFile("evidence")
	if err != nil && !errors.Is(err, http.ErrMissingFile) {
		return model.CreatePublicClaimRequest{}, nil, err
	}
	var evidence *service.ClaimEvidenceUpload
	if fileHeader != nil {
		if fileHeader.Size > 1<<20 {
			return model.CreatePublicClaimRequest{}, nil, fmt.Errorf("la evidencia debe pesar como maximo 1 MB")
		}
		ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
		mimeType := fileHeader.Header.Get("Content-Type")
		if mimeType == "" {
			mimeType = mime.TypeByExtension(ext)
		}
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		if ext != ".txt" && ext != ".pdf" && !strings.HasPrefix(mimeType, "image/") {
			return model.CreatePublicClaimRequest{}, nil, fmt.Errorf("la evidencia debe ser un archivo .txt, .pdf o una imagen")
		}
		file, err := fileHeader.Open()
		if err != nil {
			return model.CreatePublicClaimRequest{}, nil, err
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, 1<<20+1))
		if err != nil {
			return model.CreatePublicClaimRequest{}, nil, err
		}
		if int64(len(data)) > 1<<20 {
			return model.CreatePublicClaimRequest{}, nil, fmt.Errorf("la evidencia debe pesar como maximo 1 MB")
		}
		evidence = &service.ClaimEvidenceUpload{
			FileName: fileHeader.Filename,
			MimeType: mimeType,
			Data:     data,
		}
	}
	if req.ClaimType == model.ClaimTypeDamage && containsAny(damageSubtypes, "product_damaged") && evidence == nil {
		return model.CreatePublicClaimRequest{}, nil, fmt.Errorf("la evidencia es obligatoria para producto dañado")
	}
	return req, evidence, nil
}

func splitCSV(value string) []string {
	if value == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func containsAny(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

// GetPublicClaim returns a public claim by ID.
//
// @Summary      Get public claim
// @Description  Returns a claim by ID. No authentication required.
// @Tags         public
// @Produce      json
// @Param        id   path      string  true  "Claim ID"
// @Success      200  {object}  model.Claim
// @Failure      404  {object}  map[string]string
// @Router       /public/claims/{id} [get]
func (h *ClaimHandler) GetPublicClaim(c *gin.Context) {
	claim, err := h.svc.GetByID(c.Param("id"))
	if err != nil {
		if err == repository.ErrClaimNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, claim)
}

// DownloadClaimEvidence returns the uploaded evidence file for a claim.
//
// @Summary      Download claim evidence
// @Description  Downloads the evidence attached to a claim. Operator and supervisor only.
// @Tags         claims
// @Produce      application/octet-stream
// @Security     BearerAuth
// @Param        id   path      string  true  "Claim ID"
// @Success      200  {file}    file
// @Failure      403  {object}  map[string]string
// @Failure      404  {object}  map[string]string
// @Router       /claims/{id}/evidence/download [get]
func (h *ClaimHandler) DownloadClaimEvidence(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	claim, err := h.svc.GetByIDForBranch(c.Param("id"), user.BranchID)
	if err != nil {
		if err == repository.ErrClaimNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		if err == service.ErrClaimForbidden {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if strings.TrimSpace(claim.EvidenceFilePath) == "" || strings.TrimSpace(claim.EvidenceFileName) == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "el reclamo no tiene evidencia adjunta"})
		return
	}
	if _, err := os.Stat(claim.EvidenceFilePath); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "la evidencia no está disponible"})
		return
	}
	c.FileAttachment(claim.EvidenceFilePath, filepath.Base(claim.EvidenceFileName))
}

// DownloadClaimResponseEvidence devuelve la evidencia adjuntada por el cliente al responder un reclamo.
func (h *ClaimHandler) DownloadClaimResponseEvidence(c *gin.Context) {
	user := c.MustGet(middleware.UserKey).(model.User)
	claimID := c.Param("id")

	if _, err := h.svc.GetByIDForBranch(claimID, user.BranchID); err != nil {
		if err == service.ErrClaimForbidden {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "reclamo no encontrado"})
		return
	}

	events, err := h.svc.GetEvents(claimID, user.BranchID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo obtener el historial"})
		return
	}

	var evidenceFileName, evidenceFilePath string
	for i := len(events) - 1; i >= 0; i-- {
		ev := events[i]
		if ev.EventType == string(model.EventClaimCustomerResponded) && ev.EvidenceFilePath != "" {
			evidenceFileName = ev.EvidenceFileName
			evidenceFilePath = ev.EvidenceFilePath
			break
		}
	}
	if evidenceFilePath == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "el reclamo no tiene evidencia de respuesta adjunta"})
		return
	}
	if _, err := os.Stat(evidenceFilePath); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "la evidencia no está disponible en el servidor"})
		return
	}
	c.FileAttachment(evidenceFilePath, filepath.Base(evidenceFileName))
}
