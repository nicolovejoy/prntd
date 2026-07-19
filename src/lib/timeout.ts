/**
 * Reject if `run` hasn't settled within `ms`. Note: this does not cancel the
 * underlying work (Promise.race can't) — it just stops the caller from waiting
 * indefinitely so an error state can render or a bounded fallback can run.
 */
export async function withTimeout<T>(
  label: string,
  ms: number,
  run: () => Promise<T>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
  });
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
