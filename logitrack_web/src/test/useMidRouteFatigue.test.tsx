import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMidRouteFatigue } from "../hooks/useMidRouteFatigue";

// ── Mock state — reference kept before vi.mock hoisting ──────────────────────
const mockGetTestEligibility = vi.fn();
const mockGetTodayCheckin = vi.fn();
const mockResetMisfires = vi.fn().mockResolvedValue({ ok: true });

// ── Module mocks (hoisted by vitest) ────────────────────────────────────────
vi.mock("../api/driver", () => ({
  driverApi: {
    getTestEligibility: (...args: unknown[]) => mockGetTestEligibility(...args),
    getTodayCheckin: (...args: unknown[]) => mockGetTodayCheckin(...args),
    resetMisfires: (...args: unknown[]) => mockResetMisfires(...args),
    // Stubs for unimplemented methods in case of transitive imports
    getRoute: vi.fn(),
    startRoute: vi.fn(),
    getCheckinGateStatus: vi.fn(),
    submitCheckin: vi.fn(),
    skipCheckin: vi.fn(),
    submitTouchEvent: vi.fn(),
    submitPVT: vi.fn(),
    fastForwardCheckinTime: vi.fn(),
    getControlPhrase: vi.fn(),
    uploadVoice: vi.fn(),
    markRouteStarted: vi.fn(),
    requestHistory: vi.fn(),
    requestHistoryDeletion: vi.fn(),
    getPersonalHistory: vi.fn(),
    getFatigueBlockStatus: vi.fn(),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function setupHook(driverId = "1") {
  return renderHook(() => useMidRouteFatigue(driverId));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("useMidRouteFatigue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("triggerGate sets showGate=true when backend says require_test=true", async () => {
    mockGetTestEligibility.mockResolvedValue({ require_test: true, reason: "tactile_and_time" });
    mockGetTodayCheckin.mockResolvedValue({ ok: true, requires_sleep_data: false });

    const { result } = setupHook();

    expect(result.current.showGate).toBe(false);

    let triggered = false;
    await act(async () => {
      triggered = await result.current.triggerGate(6);
    });

    expect(triggered).toBe(true);
    expect(result.current.showGate).toBe(true);
    expect(mockGetTestEligibility).toHaveBeenCalledWith({ misfires: 6 });
    expect(mockGetTodayCheckin).toHaveBeenCalled();
    expect(mockResetMisfires).not.toHaveBeenCalled();
  });

  it("triggerGate does NOT set showGate when require_test=false (calls resetMisfires instead)", async () => {
    mockGetTestEligibility.mockResolvedValue({ require_test: false });

    const { result } = setupHook();

    let triggered = false;
    await act(async () => {
      triggered = await result.current.triggerGate(3);
    });

    expect(triggered).toBe(false);
    expect(result.current.showGate).toBe(false);
    expect(mockResetMisfires).toHaveBeenCalled();
  });

  it("closeGate sets showGate=false and requiresSleepData=false", async () => {
    // Set up gate as open first
    mockGetTestEligibility.mockResolvedValue({ require_test: true, reason: "tactile_and_time" });
    mockGetTodayCheckin.mockResolvedValue({ ok: true, requires_sleep_data: true });

    const { result } = setupHook();

    await act(async () => {
      await result.current.triggerGate(5);
    });

    expect(result.current.showGate).toBe(true);
    expect(result.current.requiresSleepData).toBe(true);

    await act(async () => {
      result.current.closeGate();
    });

    expect(result.current.showGate).toBe(false);
    expect(result.current.requiresSleepData).toBe(false);
    expect(mockResetMisfires).toHaveBeenCalled();
  });

  it("triggerGate captures correct misfireCount when gate triggers", async () => {
    mockGetTestEligibility.mockResolvedValue({ require_test: true, reason: "tactile_and_time" });
    mockGetTodayCheckin.mockResolvedValue({ ok: true, requires_sleep_data: true });

    const { result } = setupHook();

    await act(async () => {
      await result.current.triggerGate(12);
    });

    expect(result.current.misfireCount).toBe(12);

    // Trigger again with different count
    await act(async () => {
      result.current.closeGate();
    });

    mockGetTestEligibility.mockResolvedValue({ require_test: true, reason: "checkpoint" });
    await act(async () => {
      await result.current.triggerGate(7);
    });

    expect(result.current.misfireCount).toBe(7);
  });

  it("requiresSleepData defaults to true and updates from backend response", async () => {
    const { result } = setupHook();
    expect(result.current.requiresSleepData).toBe(true);

    mockGetTestEligibility.mockResolvedValue({ require_test: true, reason: "tactile_and_time" });
    mockGetTodayCheckin.mockResolvedValue({ ok: true, requires_sleep_data: false });

    await act(async () => {
      await result.current.triggerGate(4);
    });

    expect(result.current.requiresSleepData).toBe(false);
  });
});
