package handler

import "fmt"

// vadVoiceThreshold is the minimum fraction of Opus audio blocks that must be
// classified as "voiced" for a recording to pass the Level-1 VAD check.
const vadVoiceThreshold = 0.15

// vadInvalidMsg is the user-facing message returned for any invalid recording.
const vadInvalidMsg = "No hemos detectado una grabación válida. Por favor, intenta nuevamente leyendo la frase."

// webmVAD performs frame-level Voice Activity Detection on a WebM/Opus blob.
//
// # Mechanism
//
// Browser MediaRecorder encodes audio into a WebM (Matroska) container with
// Opus frames. The Opus codec stores silence as Comfort Noise (CN) packets of
// 1–3 bytes per 20 ms frame, while voice frames at any practical speech bitrate
// are ≥ 20 bytes (e.g. 8 kbps = 20 bytes/frame, 64 kbps = 160 bytes/frame).
//
// The function scans the raw WebM bytes looking for SimpleBlock (0xA3) and
// Block (0xA1) EBML elements. For each block it strips the 4-byte Matroska
// block header (1-byte track VINT + 2-byte timecode + 1-byte flags) and
// compares the remaining Opus payload size against minVoicePayload.
//
// # Limitations and why Level-2 exists
//
// In noisy environments (truck cabins, wind) the engine / road noise can raise
// Opus frame sizes above 20 bytes even without human speech, allowing loud
// background noise to pass Level-1. The Level-2 check (speech_rate > 0 in the
// acoustic extractor) provides a complementary signal that is energy-agnostic.
//
// Returns (fraction, true,  nil) when voiced fraction ≥ threshold.
// Returns (fraction, false, nil) for silence / background-noise recordings —
// the caller can inspect `fraction` directly (e.g. to feed the acoustic
// extractor or to decide between a generic vs. an explicit "silence" error).
// Returns (0, false, err) when the container is not a valid WebM file.
func webmVAD(data []byte, threshold float64) (voicedFraction float64, ok bool, err error) {
	// All WebM / Matroska files begin with the four EBML magic bytes.
	if len(data) < 4 || data[0] != 0x1A || data[1] != 0x45 || data[2] != 0xDF || data[3] != 0xA3 {
		return 0, false, fmt.Errorf("not a valid WebM file (EBML magic not found)")
	}

	const (
		simpleBlockID   = byte(0xA3) // Matroska SimpleBlock element ID
		blockID         = byte(0xA1) // Matroska Block element ID (inside BlockGroup)
		blockHeaderSize = 4          // 1-byte track VINT + 2-byte timecode + 1-byte flags
		minVoicePayload = 20         // bytes: Opus CN = 1-3 bytes; speech ≥ 20 bytes
		maxBlockSize    = 65536      // 64 KiB sanity cap; real blocks are rarely > 2 KiB
	)

	total, voiced := 0, 0

	for i := 0; i < len(data); i++ {
		b := data[i]
		if b != simpleBlockID && b != blockID {
			continue
		}

		// Read the EBML VINT element-size field that immediately follows the ID byte.
		sz, n, ok := readEBMLVINT(data, i+1)
		if !ok || sz == 0 || sz > maxBlockSize {
			continue // not a plausible block — advance by 1 and keep scanning
		}

		payloadStart := i + 1 + n
		payloadEnd := payloadStart + int(sz)
		if payloadEnd > len(data) {
			break // truncated data
		}

		// The first byte of a valid Matroska block payload is a 1-byte track
		// VINT for tracks 1–126 (0x81 = track 1, 0x82 = track 2 …).
		// A 1-byte VINT always has its high bit set, so bit 7 must be 1.
		if payloadStart >= len(data) || data[payloadStart]&0x80 == 0 {
			continue // not a valid block payload header
		}

		if int(sz) <= blockHeaderSize {
			i = payloadEnd - 1 // jump past this element; loop i++ lands on next
			continue
		}

		opusPayloadBytes := int(sz) - blockHeaderSize
		total++
		if opusPayloadBytes >= minVoicePayload {
			voiced++
		}

		// Skip the interior of this element to avoid re-scanning its binary data.
		i = payloadEnd - 1 // loop i++ will land on the first byte after the block
	}

	if total == 0 {
		// No parseable blocks found — file may be malformed or too short.
		return 0, false, nil
	}

	fraction := float64(voiced) / float64(total)
	return fraction, fraction >= threshold, nil
}

// readEBMLVINT reads a WebM Variable-Length INTeger (VINT) from data[pos].
// The leading length-indicator bit is stripped from the returned value, as
// required by the EBML specification for element size fields.
// Returns (value, bytesConsumed, ok); ok is false on truncation or bad data.
func readEBMLVINT(data []byte, pos int) (value uint64, bytesRead int, ok bool) {
	if pos >= len(data) {
		return 0, 0, false
	}
	b := data[pos]
	mask := byte(0x80)
	for width := 1; width <= 8; width++ {
		if b&mask != 0 {
			value = uint64(b &^ mask) // strip the length-indicator bit
			for j := 1; j < width; j++ {
				if pos+j >= len(data) {
					return 0, 0, false
				}
				value = (value << 8) | uint64(data[pos+j])
			}
			return value, width, true
		}
		mask >>= 1
	}
	return 0, 0, false
}
