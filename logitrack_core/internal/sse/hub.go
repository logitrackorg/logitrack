// Package sse provides a simple fan-out hub for Server-Sent Events.
// Each connected client is registered with a user ID; calls to Push send
// a signal to every active connection for that user.
package sse

import "sync"

// Client represents a single SSE connection for a user.
type Client struct {
	UserID string
	Ch     chan struct{}
}

// Hub manages per-user SSE client sets and dispatches push signals.
type Hub struct {
	mu      sync.RWMutex
	clients map[string]map[*Client]struct{}
}

// NewHub creates a new Hub.
func NewHub() *Hub {
	return &Hub{clients: make(map[string]map[*Client]struct{})}
}

// Register adds c to the hub. Call Unregister (defer) when the connection closes.
func (h *Hub) Register(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.clients[c.UserID] == nil {
		h.clients[c.UserID] = make(map[*Client]struct{})
	}
	h.clients[c.UserID][c] = struct{}{}
}

// Unregister removes c from the hub.
func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if set, ok := h.clients[c.UserID]; ok {
		delete(set, c)
		if len(set) == 0 {
			delete(h.clients, c.UserID)
		}
	}
}

// Push sends a signal to every connected client for userID.
// Non-blocking: clients whose buffer is full are skipped.
func (h *Hub) Push(userID string) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients[userID] {
		select {
		case c.Ch <- struct{}{}:
		default:
		}
	}
}
