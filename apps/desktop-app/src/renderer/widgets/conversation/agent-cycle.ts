// Shift+Tab mode order: the session default, then each catalog agent, then
// back to the default. An unknown current value restarts at the default.
export function nextAgent(current: string, ids: readonly string[]): string {
  const order = ["", ...ids];
  return order[(order.indexOf(current) + 1) % order.length] ?? "";
}
