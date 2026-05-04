package repository

import (
	"errors"

	"github.com/logitrack/core/internal/model"
)

var ErrDuplicateBranchName = errors.New("duplicate branch name")
var ErrDuplicateBranchID = errors.New("duplicate branch id")

type BranchRepository interface {
	List() []model.Branch
	ListActive() []model.Branch
	Create(branch model.Branch) error
	Add(branch model.Branch) // for seeding; does not validate duplicates
	Update(id string, branch model.Branch) error
	UpdateStatus(id string, status model.BranchStatus, username string) error
	GetByID(id string) (model.Branch, bool)
	GetByCity(city string) (model.Branch, bool)
	GetByNameOrID(query string) []model.Branch
}
