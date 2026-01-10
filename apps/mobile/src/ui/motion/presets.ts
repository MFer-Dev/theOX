import { AccessibilityInfo } from 'react-native';

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled().then((v) => (reduceMotion = v)).catch(() => {});
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => {
  reduceMotion = v;
});

export const motionPresets = {
  tap: { scaleTo: 0.97, opacityTo: 0.9, duration: 110, easing: 'ease-out' },
  overlay: { duration: 200, easing: 'ease-out' },
  nav: { duration: 230, easing: 'ease-in-out' },
  load: { duration: 280, easing: 'ease-out' },
};

const reduced = { duration: 0, easing: 'linear' };

export const resolveMotion = <K extends keyof typeof motionPresets>(key: K) =>
  reduceMotion ? { ...motionPresets[key], ...reduced } : motionPresets[key];

export const tapPreset = { pressStyle: { opacity: 0.85, transform: [{ scale: 0.98 }] } };
export const overlayPreset = { animation: reduceMotion ? undefined : 'quick', enterStyle: { opacity: 0 }, exitStyle: { opacity: 0 } };
export const navPreset = { animation: reduceMotion ? undefined : 'medium' };
export const loadPreset = { animation: reduceMotion ? undefined : 'lazy' };

