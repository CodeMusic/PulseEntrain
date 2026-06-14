// Shared dark theme palette for PulseEntrain.
export const COLORS = {
  bgDark: '#0F1419',
  bgCard: '#1A1F2E',
  bgCardLight: '#252B3D',
  textPrimary: '#FFFFFF',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  accentBlue: '#3B82F6',
  accentBlueLight: '#60A5FA',
  accentGreen: '#10B981',
  accentRed: '#EF4444',
  accentOrange: '#F59E0B',
  divider: '#374151',
};

// Map a 1-7 strength to a colour for the badge.
export const strengthColor = s => {
  if (s >= 6) return COLORS.accentRed;
  if (s >= 4) return COLORS.accentOrange;
  if (s >= 3) return COLORS.accentBlueLight;
  return COLORS.accentGreen;
};
