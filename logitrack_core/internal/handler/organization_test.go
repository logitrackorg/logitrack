package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/logitrack/core/internal/middleware"
	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
	"github.com/logitrack/core/internal/service"
)

// orgTestSetup holds dependencies for organization handler tests.
type orgTestSetup struct {
	handler *OrganizationHandler
	svc     *service.OrganizationService
}

func newOrgTestSetup() orgTestSetup {
	repo := repository.NewInMemoryOrganizationRepository()
	svc := service.NewOrganizationService(repo)
	h := NewOrganizationHandler(svc)
	return orgTestSetup{h, svc}
}

// orgDo sends an HTTP request through a fresh gin router,
// optionally injecting a user into the context via middleware.
func (ts *orgTestSetup) orgDo(t *testing.T, method, path string, body any, user *model.User) *httptest.ResponseRecorder {
	t.Helper()
	r := gin.New()
	if user != nil {
		r.Use(func(c *gin.Context) {
			c.Set(middleware.UserKey, user)
			c.Next()
		})
	}
	r.GET("/organization", ts.handler.Get)
	r.PUT("/organization", ts.handler.Update)
	r.GET("/public/organization", ts.handler.GetPublic)

	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestOrgHandler_Update_FontFamily(t *testing.T) {
	ts := newOrgTestSetup()
	admin := &model.User{Username: "admin", Role: model.RoleAdmin}

	w := ts.orgDo(t, http.MethodPut, "/organization",
		gin.H{"name": "Test", "font_family": "Roboto"}, admin)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	if resp["font_family"] != "Roboto" {
		t.Errorf("expected font_family=Roboto, got %v", resp["font_family"])
	}
	if resp["name"] != "Test" {
		t.Errorf("expected name=Test, got %v", resp["name"])
	}
}

func TestOrgHandler_Update_InvalidFont(t *testing.T) {
	ts := newOrgTestSetup()
	admin := &model.User{Username: "admin", Role: model.RoleAdmin}

	w := ts.orgDo(t, http.MethodPut, "/organization",
		gin.H{"name": "Test", "font_family": "Invalid"}, admin)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	if resp["error"] == nil {
		t.Fatal("expected error message in response, got nil")
	}
}

func TestOrgHandler_Get_IncludesFontFamily(t *testing.T) {
	ts := newOrgTestSetup()
	admin := &model.User{Username: "admin", Role: model.RoleAdmin}

	// First save a config with a font
	ts.orgDo(t, http.MethodPut, "/organization",
		gin.H{"name": "Test", "font_family": "Open Sans"}, admin)

	// Now GET it
	w := ts.orgDo(t, http.MethodGet, "/organization", nil, admin)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	if resp["font_family"] != "Open Sans" {
		t.Errorf("expected font_family=Open Sans, got %v", resp["font_family"])
	}
}

func TestOrgHandler_GetPublic_IncludesFontFamily(t *testing.T) {
	ts := newOrgTestSetup()
	admin := &model.User{Username: "admin", Role: model.RoleAdmin}

	// First save a config with a font
	ts.orgDo(t, http.MethodPut, "/organization",
		gin.H{"name": "Test", "font_family": "Inter"}, admin)

	// GET /public/organization — no user needed
	w := ts.orgDo(t, http.MethodGet, "/public/organization", nil, nil)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	if resp["font_family"] != "Inter" {
		t.Errorf("expected font_family=Inter, got %v", resp["font_family"])
	}
}
