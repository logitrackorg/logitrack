package repository

import "github.com/logitrack/core/internal/model"

type AccessLogRepository interface {
	Log(entry model.AccessLog) error
	List(limit int) ([]model.AccessLog, error)
}
