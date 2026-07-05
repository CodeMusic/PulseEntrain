// ROLI Lightpad Block — default note grid → (column, row). Confirmed from device
// logs: a 5×5 grid from C3 (base note 48), +1 semitone per column, +5 per row.
// Decoding a touched note into a cell lets callers treat the pad as an XY space
// (column = X, row = Y). Pitch bend fine-tunes the column between cells.
export const LP_BASE = 48;
export const LP_COLS = 5;
export const LP_ROWS = 5;
export const LP_ROW_OFFSET = 5;
export const LP_BEND_PER_COL = 170; // 14-bit pitch-bend units ≈ one semitone (one column)

export function decodeCell(note) {
  const n = note - LP_BASE;
  const row = Math.max(0, Math.min(LP_ROWS - 1, Math.floor(n / LP_ROW_OFFSET)));
  const col = Math.max(0, Math.min(LP_COLS - 1, n - row * LP_ROW_OFFSET));
  return { col, row };
}
