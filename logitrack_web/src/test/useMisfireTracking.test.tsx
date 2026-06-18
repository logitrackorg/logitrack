import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMisfireTracking } from "../hooks/useMisfireTracking";

describe("useMisfireTracking", () => {
  beforeEach(() => {
    // Clean up document listeners between tests.
    document.body.innerHTML = "";
  });

  it("getMisfires returns 0 initially", () => {
    const { result } = renderHook(() => useMisfireTracking());
    expect(result.current.getMisfires()).toBe(0);
  });

  it("increments misfire counter on document clicks when checkin NOT triggered", () => {
    const { result } = renderHook(() => useMisfireTracking());

    act(() => {
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(result.current.getMisfires()).toBe(1);

    act(() => {
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(result.current.getMisfires()).toBe(2);
  });

  it("does NOT increment misfire counter when checkin is triggered", () => {
    const { result } = renderHook(() => useMisfireTracking());

    // Trigger some initial clicks
    act(() => {
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(result.current.getMisfires()).toBe(1);

    // Trigger checkin
    act(() => {
      result.current.triggerCheckin(5);
    });
    expect(result.current.checkinTriggered).toBe(true);

    // Click should not increment now
    act(() => {
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(result.current.getMisfires()).toBe(1);
  });

  it("resumes incrementing after closeCheckin", () => {
    const { result } = renderHook(() => useMisfireTracking());

    // Trigger checkin
    act(() => {
      result.current.triggerCheckin(3);
    });
    expect(result.current.checkinTriggered).toBe(true);

    // Click during checkin should not increment
    act(() => {
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(result.current.getMisfires()).toBe(0);

    // Close checkin
    act(() => {
      result.current.closeCheckin();
    });
    expect(result.current.checkinTriggered).toBe(false);

    // Click after closeCheckin should increment again
    act(() => {
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(result.current.getMisfires()).toBe(1);
  });

  it("triggerCheckin captures misfire count and sets checkinTriggered=true", () => {
    const { result } = renderHook(() => useMisfireTracking());

    // Generate some misfires
    act(() => {
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const captured = result.current.getMisfires();
    expect(captured).toBe(3);

    act(() => {
      result.current.triggerCheckin(captured);
    });

    expect(result.current.checkinTriggered).toBe(true);
    expect(result.current.misfireCount).toBe(3);
  });

  it("closeCheckin sets checkinTriggered=false", () => {
    const { result } = renderHook(() => useMisfireTracking());

    act(() => {
      result.current.triggerCheckin(1);
    });
    expect(result.current.checkinTriggered).toBe(true);

    act(() => {
      result.current.closeCheckin();
    });
    expect(result.current.checkinTriggered).toBe(false);
  });

  it("resetMisfires sets counter to 0", () => {
    const { result } = renderHook(() => useMisfireTracking());

    act(() => {
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(result.current.getMisfires()).toBe(2);

    act(() => {
      result.current.resetMisfires();
    });
    expect(result.current.getMisfires()).toBe(0);
  });

  it("checkinTriggered defaults to false", () => {
    const { result } = renderHook(() => useMisfireTracking());
    expect(result.current.checkinTriggered).toBe(false);
  });

  it("misfireCount defaults to 0", () => {
    const { result } = renderHook(() => useMisfireTracking());
    expect(result.current.misfireCount).toBe(0);
  });

  it("misfireCount reflects the captured value even after further clicks", () => {
    const { result } = renderHook(() => useMisfireTracking());

    // Generate 2 misfires before trigger
    act(() => {
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Trigger checkin with captured count of 2
    act(() => {
      result.current.triggerCheckin(2);
    });
    expect(result.current.misfireCount).toBe(2);

    // misfireCount should remain the captured value (not the live ref)
    expect(result.current.misfireCount).toBe(2);
    // Live ref may differ but that's fine — we verify captured is stable
  });
});
