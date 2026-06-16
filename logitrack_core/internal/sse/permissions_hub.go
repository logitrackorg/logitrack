package sse

import "sync"

// PermissionsHub broadcasts a signal to all authenticated SSE clients when
// metric permissions change. Unlike Hub it is not scoped to a user ID —
// any connected client receives the broadcast regardless of who triggered it.
type PermissionsHub struct {
	mu      sync.RWMutex
	clients map[chan struct{}]struct{}
}

func NewPermissionsHub() *PermissionsHub {
	return &PermissionsHub{clients: make(map[chan struct{}]struct{})}
}

// Subscribe returns a buffered channel that receives a signal on each Broadcast.
func (h *PermissionsHub) Subscribe() chan struct{} {
	ch := make(chan struct{}, 1)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

// Unsubscribe removes the channel when the SSE connection closes.
func (h *PermissionsHub) Unsubscribe(ch chan struct{}) {
	h.mu.Lock()
	delete(h.clients, ch)
	h.mu.Unlock()
}

// Broadcast sends a non-blocking signal to every connected client.
func (h *PermissionsHub) Broadcast() {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.clients {
		select {
		case ch <- struct{}{}:
		default: // skip slow consumers
		}
	}
}
