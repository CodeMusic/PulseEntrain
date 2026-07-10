// The ROLI Lightpad is a grid of pads, each its own MIDI note — so a single finger
// gliding across it fires a NEW noteOn every time it crosses a pad (with noteOff for
// the one it left). Fed straight to a touch handler, each noteOn looks like a fresh
// touch and resets the pull anchor, so the block never feels like it's dragging.
//
// This coalesces that pad-note churn into ONE gesture (start … move … end), the way
// the phone pad's single touch already behaves. It counts held notes (handles
// overlapping legato) and ends only after a short grace with nothing held (handles
// the gap between a noteOff and the next pad's noteOn). Caller wires the raw events
// to noteOn/move/setPressure/noteOff and provides:
//   position() → { xN, yN }   the current normalised block position
//   emit(evt)                 receives { phase:'start'|'move'|'end', xN, yN, pressure }
export function makeBlockGesture({ position, emit, endGraceMs = 90 }) {
  let notes = 0; // pads currently held
  let endTimer = null;
  let pressure = 0.5; // last Z (0..1); pads that never send pressure still read as a medium press
  const active = () => notes > 0 || endTimer != null;
  const cancelEnd = () => { if (endTimer) { clearTimeout(endTimer); endTimer = null; } };

  return {
    noteOn() {
      const wasActive = active();
      cancelEnd();
      notes += 1;
      emit({ phase: wasActive ? 'move' : 'start', ...position(), pressure });
    },
    move() {
      if (active()) emit({ phase: 'move', ...position(), pressure });
    },
    setPressure(p) {
      pressure = p;
      if (active()) emit({ phase: 'move', ...position(), pressure });
    },
    noteOff() {
      notes = Math.max(0, notes - 1);
      if (notes === 0 && !endTimer) {
        endTimer = setTimeout(() => { endTimer = null; emit({ phase: 'end' }); }, endGraceMs);
      }
    },
    reset() { cancelEnd(); notes = 0; },
  };
}
