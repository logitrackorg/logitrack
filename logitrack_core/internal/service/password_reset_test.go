package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/logitrack/core/internal/model"
	"github.com/logitrack/core/internal/repository"
	"golang.org/x/crypto/bcrypt"
)

// ─── fakes ────────────────────────────────────────────────────────────────────

type resetFakeAuthRepo struct {
	users           map[string]model.User // keyed by username
	updatedPassword map[string]string     // userID → hashed
}

func newResetFakeAuthRepo(users ...model.User) *resetFakeAuthRepo {
	r := &resetFakeAuthRepo{
		users:           make(map[string]model.User),
		updatedPassword: make(map[string]string),
	}
	for _, u := range users {
		r.users[u.Username] = u
	}
	return r
}

func (r *resetFakeAuthRepo) FindUserByUsername(username string) (model.User, bool) {
	u, ok := r.users[username]
	return u, ok
}

func (r *resetFakeAuthRepo) UpdatePassword(userID, hashedPassword string) error {
	r.updatedPassword[userID] = hashedPassword
	return nil
}

// unused interface methods
func (r *resetFakeAuthRepo) FindUser(_, _ string) (model.User, error)                         { return model.User{}, errors.New("not implemented") }
func (r *resetFakeAuthRepo) SaveToken(_ string, _ model.User)                                 {}
func (r *resetFakeAuthRepo) GetUserByToken(_ string) (model.User, error)                      { return model.User{}, nil }
func (r *resetFakeAuthRepo) DeleteToken(_ string)                                             {}
func (r *resetFakeAuthRepo) ListByRole(_ model.Role, _ string) []model.User                   { return nil }
func (r *resetFakeAuthRepo) ListAll() []model.User                                            { return nil }
func (r *resetFakeAuthRepo) GetUserByID(_ string) (model.User, error)                         { return model.User{}, nil }
func (r *resetFakeAuthRepo) UpdateUser(_ string, _ repository.UserUpdate) (model.User, error) { return model.User{}, nil }
func (r *resetFakeAuthRepo) CreateUser(_ repository.UserCreate) (model.User, error)           { return model.User{}, nil }
func (r *resetFakeAuthRepo) ChangePassword(_ context.Context, _, _, _ string) error           { return nil }

type fakeResetRepo struct {
	mu     sync.Mutex
	tokens []*repository.PasswordResetToken
}

func (r *fakeResetRepo) Create(userID, tokenHash string, expiresAt time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tokens = append(r.tokens, &repository.PasswordResetToken{
		ID:        "tok-" + userID + "-" + tokenHash[:6],
		UserID:    userID,
		TokenHash: tokenHash,
		ExpiresAt: expiresAt,
		CreatedAt: time.Now(),
	})
	return nil
}

func (r *fakeResetRepo) FindValidByUser(userID string) (*repository.PasswordResetToken, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	for i := len(r.tokens) - 1; i >= 0; i-- {
		t := r.tokens[i]
		if t.UserID == userID && t.UsedAt == nil && t.ExpiresAt.After(now) {
			return t, nil
		}
	}
	return nil, nil
}

func (r *fakeResetRepo) MarkUsed(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	for _, t := range r.tokens {
		if t.ID == id {
			t.UsedAt = &now
			return nil
		}
	}
	return nil
}

func (r *fakeResetRepo) CountRecentByUser(userID string, since time.Time) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	count := 0
	for _, t := range r.tokens {
		if t.UserID == userID && t.CreatedAt.After(since) {
			count++
		}
	}
	return count, nil
}

type fakeAccessLog struct {
	entries []model.AccessLog
}

func (f *fakeAccessLog) Log(e model.AccessLog) error {
	f.entries = append(f.entries, e)
	return nil
}
func (f *fakeAccessLog) List(_ int) ([]model.AccessLog, error) { return f.entries, nil }
func (f *fakeAccessLog) ListFiltered(_ model.AccessLogFilter) ([]model.AccessLog, error) {
	return f.entries, nil
}

// ─── helpers ──────────────────────────────────────────────────────────────────

func newSvc(authRepo *resetFakeAuthRepo, resetRepo *fakeResetRepo, accessLog *fakeAccessLog) *PasswordResetService {
	return NewPasswordResetService(authRepo, resetRepo, nil, "", "", "", accessLog)
}

// ─── tests ────────────────────────────────────────────────────────────────────

func TestRequestReset_UserNotFound_ReturnsNil(t *testing.T) {
	svc := newSvc(newResetFakeAuthRepo(), &fakeResetRepo{}, &fakeAccessLog{})
	if err := svc.RequestReset("noexiste"); err != nil {
		t.Fatalf("esperado nil, got %v", err)
	}
}

func TestRequestReset_UserWithoutContact_ReturnsNil(t *testing.T) {
	user := model.User{ID: "1", Username: "sin_contacto", Email: "", Phone: "", Status: model.UserStatusActive}
	svc := newSvc(newResetFakeAuthRepo(user), &fakeResetRepo{}, &fakeAccessLog{})
	if err := svc.RequestReset("sin_contacto"); err != nil {
		t.Fatalf("esperado nil, got %v", err)
	}
}

func TestRequestReset_LogsAccessEvent(t *testing.T) {
	user := model.User{ID: "2", Username: "con_email", Email: "test@example.com", Status: model.UserStatusActive}
	accessLog := &fakeAccessLog{}
	svc := newSvc(newResetFakeAuthRepo(user), &fakeResetRepo{}, accessLog)
	_ = svc.RequestReset("con_email")
	if len(accessLog.entries) != 1 {
		t.Fatalf("esperado 1 log, got %d", len(accessLog.entries))
	}
	if accessLog.entries[0].EventType != model.AccessEventPasswordResetRequested {
		t.Errorf("tipo de evento incorrecto: %s", accessLog.entries[0].EventType)
	}
}

func TestConfirmReset_ValidOTP_UpdatesPassword(t *testing.T) {
	user := model.User{ID: "3", Username: "usuario1", Email: "u@test.com", Status: model.UserStatusActive}
	authRepo := newResetFakeAuthRepo(user)
	resetRepo := &fakeResetRepo{}
	svc := newSvc(authRepo, resetRepo, &fakeAccessLog{})

	// Request first to create a token
	_ = svc.RequestReset("usuario1")

	// Get the hashed OTP from the repo and manually test
	// We'll call ConfirmReset with a known OTP by injecting the hash directly
	otp := "123456"
	hashed, _ := bcrypt.GenerateFromPassword([]byte(otp), bcrypt.DefaultCost)
	resetRepo.tokens[len(resetRepo.tokens)-1].TokenHash = string(hashed)

	if err := svc.ConfirmReset("usuario1", otp, "nuevapassword123"); err != nil {
		t.Fatalf("error inesperado: %v", err)
	}
	if _, ok := authRepo.updatedPassword[user.ID]; !ok {
		t.Error("contraseña no fue actualizada")
	}
}

func TestConfirmReset_ExpiredToken_ReturnsError(t *testing.T) {
	user := model.User{ID: "4", Username: "usuario2", Email: "u2@test.com", Status: model.UserStatusActive}
	resetRepo := &fakeResetRepo{}
	svc := newSvc(newResetFakeAuthRepo(user), resetRepo, &fakeAccessLog{})

	// Inject an expired token
	past := time.Now().Add(-10 * time.Minute)
	hashed, _ := bcrypt.GenerateFromPassword([]byte("654321"), bcrypt.DefaultCost)
	resetRepo.tokens = append(resetRepo.tokens, &repository.PasswordResetToken{
		ID: "expired", UserID: user.ID, TokenHash: string(hashed),
		ExpiresAt: past, CreatedAt: time.Now().Add(-15 * time.Minute),
	})

	err := svc.ConfirmReset("usuario2", "654321", "nuevapassword123")
	if err == nil {
		t.Fatal("esperaba error por token expirado, got nil")
	}
}

func TestConfirmReset_UsedTokenTwice_SecondCallFails(t *testing.T) {
	user := model.User{ID: "5", Username: "usuario3", Email: "u3@test.com", Status: model.UserStatusActive}
	authRepo := newResetFakeAuthRepo(user)
	resetRepo := &fakeResetRepo{}
	svc := newSvc(authRepo, resetRepo, &fakeAccessLog{})

	otp := "111222"
	hashed, _ := bcrypt.GenerateFromPassword([]byte(otp), bcrypt.DefaultCost)
	resetRepo.tokens = append(resetRepo.tokens, &repository.PasswordResetToken{
		ID: "tok1", UserID: user.ID, TokenHash: string(hashed),
		ExpiresAt: time.Now().Add(5 * time.Minute), CreatedAt: time.Now(),
	})

	if err := svc.ConfirmReset("usuario3", otp, "nuevapassword123"); err != nil {
		t.Fatalf("primer confirm falló inesperadamente: %v", err)
	}

	if err := svc.ConfirmReset("usuario3", otp, "otrapassword123"); err == nil {
		t.Fatal("segundo confirm debería fallar (token ya usado)")
	}
}

func TestRequestReset_RateLimit_FourthRequestFails(t *testing.T) {
	user := model.User{ID: "6", Username: "usuario4", Email: "u4@test.com", Status: model.UserStatusActive}
	resetRepo := &fakeResetRepo{}
	svc := newSvc(newResetFakeAuthRepo(user), resetRepo, &fakeAccessLog{})

	// Inject 3 tokens created recently
	for i := 0; i < 3; i++ {
		resetRepo.tokens = append(resetRepo.tokens, &repository.PasswordResetToken{
			ID: "pre" + string(rune('0'+i)), UserID: user.ID, TokenHash: "hash",
			ExpiresAt: time.Now().Add(5 * time.Minute), CreatedAt: time.Now(),
		})
	}

	err := svc.RequestReset("usuario4")
	if !errors.Is(err, ErrRateLimited) {
		t.Fatalf("esperado ErrRateLimited, got %v", err)
	}
}

func TestConfirmReset_WeakPassword_ReturnsErrWeakPassword(t *testing.T) {
	user := model.User{ID: "7", Username: "usuario5", Email: "u5@test.com", Status: model.UserStatusActive}
	resetRepo := &fakeResetRepo{}
	otp := "999888"
	hashed, _ := bcrypt.GenerateFromPassword([]byte(otp), bcrypt.DefaultCost)
	resetRepo.tokens = append(resetRepo.tokens, &repository.PasswordResetToken{
		ID: "tok2", UserID: user.ID, TokenHash: string(hashed),
		ExpiresAt: time.Now().Add(5 * time.Minute), CreatedAt: time.Now(),
	})
	svc := newSvc(newResetFakeAuthRepo(user), resetRepo, &fakeAccessLog{})

	err := svc.ConfirmReset("usuario5", otp, "corta")
	if !errors.Is(err, ErrWeakPassword) {
		t.Fatalf("esperado ErrWeakPassword, got %v", err)
	}
}
