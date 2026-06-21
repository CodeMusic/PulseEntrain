import React from 'react';

// Web stub for @react-native-community/slider — render a native range input.
// Forwards the start/commit callbacks too, so seek-style sliders (grab → drag →
// release) work: onSlidingStart on press, onValueChange while dragging,
// onSlidingComplete on release. Without these, a value bound to live playback
// snaps the thumb back and you can't grab it.
export default function Slider({
  value,
  minimumValue = 0,
  maximumValue = 1,
  step = 0,
  disabled = false,
  onValueChange,
  onSlidingStart,
  onSlidingComplete,
  minimumTrackTintColor,
  style,
}) {
  return React.createElement('input', {
    type: 'range',
    min: minimumValue,
    max: maximumValue,
    step: step || 'any',
    value,
    disabled,
    onPointerDown: () => onSlidingStart && onSlidingStart(value),
    onChange: e => onValueChange && onValueChange(parseFloat(e.target.value)),
    onPointerUp: e => onSlidingComplete && onSlidingComplete(parseFloat(e.target.value)),
    onKeyUp: e => onSlidingComplete && onSlidingComplete(parseFloat(e.target.value)),
    style: {
      width: '100%',
      accentColor: minimumTrackTintColor || '#3B82F6',
      height: 40,
      opacity: disabled ? 0.4 : 1,
      cursor: disabled ? 'default' : 'pointer',
    },
  });
}
