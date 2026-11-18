export const IDLE_WARNING_MS = 90_000;
export const IDLE_LOGOUT_MS = 120_000;

export function getIdleStage(elapsedMs) {
  if (elapsedMs >= IDLE_LOGOUT_MS) return 'logout';
  if (elapsedMs >= IDLE_WARNING_MS) return 'warning';
  return 'active';
}
