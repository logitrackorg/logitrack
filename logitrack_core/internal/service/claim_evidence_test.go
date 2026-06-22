package service

import (
	"bytes"
	"strings"
	"testing"
)

func TestIsAllowedClaimEvidence(t *testing.T) {
	cases := []struct {
		name     string
		filename string
		mime     string
		want     bool
	}{
		{"jpg image", "foto.jpg", "image/jpeg", true},
		{"png sin mime", "foto.png", "", true},
		{"pdf", "evidencia.pdf", "application/pdf", true},
		{"txt", "nota.txt", "text/plain", true},
		{"pdf por extension solo", "x.PDF", "", true},
		{"docx prohibido", "doc.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", false},
		{"doc prohibido", "doc.doc", "application/msword", false},
		{"zip prohibido", "archivo.zip", "application/zip", false},
		{"sin extension ni mime conocido", "raro", "application/octet-stream", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsAllowedClaimEvidence(tc.filename, tc.mime); got != tc.want {
				t.Fatalf("got=%v want=%v", got, tc.want)
			}
		})
	}
}

func TestValidateEvidenceUpload_NilOk(t *testing.T) {
	if err := validateEvidenceUpload(nil); err != nil {
		t.Fatalf("nil evidence debe ser válido (es opcional): %v", err)
	}
}

func TestValidateEvidenceUpload_RejectsBigFile(t *testing.T) {
	big := bytes.Repeat([]byte{0x00}, int(MaxClaimEvidenceSize)+1)
	err := validateEvidenceUpload(&ClaimEvidenceUpload{
		FileName: "foto.jpg",
		MimeType: "image/jpeg",
		Data:     big,
	})
	if err == nil {
		t.Fatalf("se esperaba rechazo por tamaño")
	}
	if !strings.Contains(err.Error(), "maximo 1 MB") {
		t.Fatalf("mensaje inesperado: %v", err)
	}
}

func TestValidateEvidenceUpload_RejectsBadType(t *testing.T) {
	err := validateEvidenceUpload(&ClaimEvidenceUpload{
		FileName: "doc.docx",
		MimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		Data:     []byte("..."),
	})
	if err == nil {
		t.Fatalf("se esperaba rechazo por tipo")
	}
}

func TestValidateEvidenceUpload_AcceptsImagePdfTxt(t *testing.T) {
	cases := []ClaimEvidenceUpload{
		{FileName: "x.jpg", MimeType: "image/jpeg", Data: []byte("a")},
		{FileName: "x.pdf", MimeType: "application/pdf", Data: []byte("a")},
		{FileName: "x.txt", MimeType: "text/plain", Data: []byte("a")},
	}
	for _, ev := range cases {
		ev := ev
		t.Run(ev.FileName, func(t *testing.T) {
			if err := validateEvidenceUpload(&ev); err != nil {
				t.Fatalf("se esperaba aceptación, got %v", err)
			}
		})
	}
}
