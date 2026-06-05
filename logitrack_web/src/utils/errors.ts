export function extractErrorMessage(err: unknown): string | undefined {
  const axiosErr = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
  if (axiosErr) return axiosErr;
  if (err instanceof Error) return err.message;
  return undefined;
}
