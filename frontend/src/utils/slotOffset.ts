/**
 * Helpers for translating the admin-configured time_slot_offset
 * into player-facing copy.
 */

/**
 * Returns the tolerance window (in minutes) to display to players for the
 * given offset, or null when no tolerance disclaimer should be shown.
 *
 * Offset 0 produces a clean half-hour slot layout aligned to :00/:30 with no
 * cross-hour drift, so no disclaimer is needed.
 *
 * Offsets -10 and -20 both yield a layout where the effective drift from a
 * player's selected hour can reach roughly 20 minutes.
 *
 * Offset -15 yields a layout where the drift is roughly 15 minutes.
 */
export function getToleranceMinutes(
  offset: number | null | undefined
): number | null {
  if (offset === null || offset === undefined) return null;
  if (offset === 0) return null;
  if (offset === -15) return 15;
  if (offset === -10 || offset === -20) return 20;
  return null;
}
