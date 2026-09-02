/* The J3NSONTOP palette, lifted from the web app's CSS custom properties so the
 * React Native build is the same object as the Android and iOS ones. */
import { Platform } from 'react-native';

export const colors = {
  ink: '#05070a',
  ink2: '#0a0f14',
  panel: '#0b1015',
  acid: '#7CFF00',
  cyan: '#00E5FF',
  amber: '#FFC400',
  mag: '#FF00A8',
  red: '#FF3B3B',
  paper: '#E9FFF2',
  dim: '#8ea79a',
  dim2: '#5f7268',
  line: 'rgba(124,255,0,0.22)',
  line2: 'rgba(124,255,0,0.10)',
} as const;

export const mono = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
}) as string;

/** Severity -> colour, shared by the integrity and VR screens. */
export const sevColor: Record<string, string> = {
  critical: colors.red,
  high: colors.red,
  med: colors.amber,
  low: colors.cyan,
  info: colors.dim,
  ok: colors.acid,
  // VR blocker levels
  hard: colors.red,
  shim: colors.amber,
  emulator: colors.amber,
  fixable: colors.cyan,
  design: colors.dim,
  none: colors.dim,
};

export const sevLabel: Record<string, string> = {
  critical: 'CRITICAL',
  high: 'HIGH',
  med: 'MEDIUM',
  low: 'LOW',
  info: 'INFO',
  ok: 'OK',
  hard: 'HARD',
  shim: 'RUNTIME',
  emulator: 'DEVICE',
  fixable: 'FIXABLE',
  design: 'DESIGN',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 6, md: 10, lg: 14 } as const;
