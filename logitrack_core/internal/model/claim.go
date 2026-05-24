package model

import "time"

type ClaimStatus string

const (
	ClaimStatusOpen                 ClaimStatus = "open"
	ClaimStatusInReview             ClaimStatus = "in_review"
	ClaimStatusPendingCustomer      ClaimStatus = "pending_customer"
	ClaimStatusDerived              ClaimStatus = "derived"
	ClaimStatusResolvedOperativa    ClaimStatus = "resolved_operativa"
	ClaimStatusResolvedComercial    ClaimStatus = "resolved_comercial"
	ClaimStatusResolvedRRHH         ClaimStatus = "resolved_rrhh"
	ClaimStatusResolvedImprocedente ClaimStatus = "resolved_improcedente"
)

type ClaimType string

const (
	ClaimTypeDamage       ClaimType = "damage"
	ClaimTypeMissing      ClaimType = "missing"
	ClaimTypeDelay        ClaimType = "delay"
	ClaimTypeNotDelivered ClaimType = "not_delivered"
	ClaimTypeBadTreatment ClaimType = "bad_treatment"
	ClaimTypeWrongData    ClaimType = "wrong_data"
	ClaimTypeOther        ClaimType = "other"
)

type ClaimCategory string

type ClaimResolutionType string

const (
	ClaimCategoryOperaciones    ClaimCategory = "operaciones"
	ClaimCategoryComercial      ClaimCategory = "comercial"
	ClaimCategoryRRHH           ClaimCategory = "rrhh"
	ClaimCategoryLegales        ClaimCategory = "legales"
	ClaimCategorySeguros        ClaimCategory = "seguros"
	ClaimCategoryAdministracion ClaimCategory = "administracion"
)

const (
	ClaimResolutionOperativa    ClaimResolutionType = "operativa"
	ClaimResolutionComercial    ClaimResolutionType = "comercial"
	ClaimResolutionRRHH         ClaimResolutionType = "rrhh"
	ClaimResolutionImprocedente ClaimResolutionType = "improcedente"
)

var ValidClaimTypes = map[ClaimType]bool{
	ClaimTypeDamage:       true,
	ClaimTypeMissing:      true,
	ClaimTypeDelay:        true,
	ClaimTypeNotDelivered: true,
	ClaimTypeBadTreatment: true,
	ClaimTypeWrongData:    true,
	ClaimTypeOther:        true,
}

var ValidClaimStatuses = map[ClaimStatus]bool{
	ClaimStatusOpen:                 true,
	ClaimStatusInReview:             true,
	ClaimStatusPendingCustomer:      true,
	ClaimStatusDerived:              true,
	ClaimStatusResolvedOperativa:    true,
	ClaimStatusResolvedComercial:    true,
	ClaimStatusResolvedRRHH:         true,
	ClaimStatusResolvedImprocedente: true,
}

var ValidClaimCategories = map[ClaimCategory]bool{
	ClaimCategoryOperaciones:    true,
	ClaimCategoryComercial:      true,
	ClaimCategoryRRHH:           true,
	ClaimCategoryLegales:        true,
	ClaimCategorySeguros:        true,
	ClaimCategoryAdministracion: true,
}

var ValidClaimResolutionTypes = map[ClaimResolutionType]bool{
	ClaimResolutionOperativa:    true,
	ClaimResolutionComercial:    true,
	ClaimResolutionRRHH:         true,
	ClaimResolutionImprocedente: true,
}

type Claim struct {
	ID                 string              `json:"id"`
	TrackingID         string              `json:"tracking_id"`
	ClaimType          ClaimType           `json:"claim_type"`
	Status             ClaimStatus         `json:"status"`
	Description        string              `json:"description"`
	CreatedBy          string              `json:"created_by"`
	CreatedAt          time.Time           `json:"created_at"`
	UpdatedAt          time.Time           `json:"updated_at"`
	AssignedCategory   ClaimCategory       `json:"assigned_category,omitempty"`
	ResolutionType     ClaimResolutionType `json:"resolution_type,omitempty"`
	IsAutomatic        bool                `json:"is_automatic"`
	EvidenceFileName   string              `json:"evidence_file_name,omitempty"`
	EvidenceFilePath   string              `json:"-"`
	EvidenceMimeType   string              `json:"evidence_mime_type,omitempty"`
	EvidenceUploadDate *time.Time          `json:"evidence_upload_date,omitempty"`
}

type CreatePublicClaimRequest struct {
	TrackingID  string    `json:"tracking_id" binding:"required"`
	ClaimType   ClaimType `json:"claim_type" binding:"required"`
	Description string    `json:"description" binding:"required"`
	CreatedBy   string    `json:"created_by" binding:"required"`
	DNI         string    `json:"dni" binding:"required"`
}

type UpdateClaimCategoryRequest struct {
	AssignedCategory ClaimCategory `json:"assigned_category" binding:"required"`
	Notes            string        `json:"notes" binding:"required"`
}

type ResolveClaimRequest struct {
	ResolutionType ClaimResolutionType `json:"resolution_type" binding:"required"`
	Notes          string              `json:"notes" binding:"required"`
}

type RequestCustomerInfoRequest struct {
	Notes string `json:"notes" binding:"required"`
}
