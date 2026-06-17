import React from 'react';

// Web stub for @react-native-community/slider — render a native range input.
export default function Slider({
  value,
  minimumValue = 0,
  maximumValue = 1,
  step = 0,
  onValueChange,
  minimumTrackTintColor,
  style,
}) {
  return React.createElement('input', {
    type: 'range',
    min: minimumValue,
    max: maximumValue,
    step: step || 'any',
    value,
    onChange: e => onValueChange && onValueChange(parseFloat(e.target.value)),
    style: { width: '100%', accentColor: minimumTrackTintColor || '#3B82F6', height: 40 },
  });
}
