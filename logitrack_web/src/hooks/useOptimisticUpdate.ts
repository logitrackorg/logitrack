import { useState, useCallback, useRef, startTransition } from "react";

interface UseOptimisticUpdateOptions<T> {
  /** Called on API failure to rollback the optimistic state */
  onRollback?: (error: Error, previousData: T) => void;
  /** Called on API success */
  onSuccess?: (result: T) => void;
  /** Called on API failure */
  onError?: (error: Error) => void;
}

interface UseOptimisticUpdateResult<T> {
  /** Execute the optimistic update. Applies optimisticData to UI immediately, fires updateFn in background */
  execute: (optimisticData: T, previousData?: T) => Promise<void>;
  /** Whether an update is currently in flight */
  isPending: boolean;
  /** The error from the last failed update, or null */
  error: Error | null;
  /** Clear the error state */
  clearError: () => void;
}

function useOptimisticUpdate<T>(
  updateFn: (data: T) => Promise<T>,
  options?: UseOptimisticUpdateOptions<T>
): UseOptimisticUpdateResult<T> {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isPendingRef = useRef(false);
  const previousDataRef = useRef<T | undefined>(undefined);

  const execute = useCallback(
    async (optimisticData: T, previousData?: T) => {
      if (isPendingRef.current) {
        return;
      }

      if (previousData !== undefined) {
        previousDataRef.current = previousData;
      }

      isPendingRef.current = true;

      startTransition(() => {
        setIsPending(true);
        setError(null);
      });

      try {
        const result = await updateFn(optimisticData);
        previousDataRef.current = result;
        startTransition(() => {
          setError(null);
        });
        options?.onSuccess?.(result);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        startTransition(() => {
          setError(error);
        });
        options?.onError?.(error);
        if (previousDataRef.current !== undefined) {
          options?.onRollback?.(error, previousDataRef.current);
        }
      } finally {
        isPendingRef.current = false;
        startTransition(() => {
          setIsPending(false);
        });
      }
    },
    [updateFn, options]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    execute,
    isPending,
    error,
    clearError,
  };
}

export { useOptimisticUpdate };
export type { UseOptimisticUpdateOptions, UseOptimisticUpdateResult };
