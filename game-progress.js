// Owner-requested progress reset. Old browser saves stay separate from fresh runs.
export const RESET_GAMES = Object.freeze(['sortie', 'drift', 'offroad', 'ultra']);
export function gameSaveKey(key) {
  return `hh-save-${key}-${RESET_GAMES.includes(key) ? 'v3' : 'v2'}`;
}

// Scarlet Rush uses the existing time-based score so server records keep ranking
// faster clears first. Present that score as elapsed time instead of speed points.
export function formatClearScore(score) {
  if (!(score > 0)) return '—';
  if (score === 1) return '1:00:00+';
  const hundredths = Math.max(0, 360000 - Math.round(score));
  const minutes = Math.floor(hundredths / 6000);
  const seconds = Math.floor(hundredths / 100) % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(hundredths % 100).padStart(2, '0')}`;
}
