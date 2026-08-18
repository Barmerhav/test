/** Resident-mode light theme. Visual constants only — business values live
 * in the config table, never here. */

export const colors = {
  bg: "#F8F6F1",
  ink: "#161616",
  accent: "#FFB020",
  success: "#0E6E56",
  danger: "#C03B2B",
  muted: "#8A8578",
  card: "#FFFFFF",
  line: "#E7E3D8",
} as const;

export const fonts = {
  regular: "Heebo_400Regular",
  medium: "Heebo_500Medium",
  bold: "Heebo_700Bold",
  mono: "JetBrainsMono_500Medium",
  monoBold: "JetBrainsMono_700Bold",
} as const;

export const radii = {
  card: 20,
  chip: 14,
  button: 26,
} as const;

/** Minimum resident-mode tap target. */
export const TAP = 48;

/** Picker-mode DARK theme (gig side). Visual constants only. */
export const pickerColors = {
  bg: "#121417",
  surface: "#1B1E24",
  /** light "paper" cards used sparingly for emphasis */
  paper: "#F2F0EA",
  text: "#F5F3EC",
  muted: "#9AA0A8",
  amber: "#FFB020",
  success: "#27C094",
  danger: "#FF6B57",
  line: "#2A2E36",
  ink: "#161616",
} as const;

/** Minimum picker-mode tap target (gloved hands, on the move). */
export const PICKER_TAP = 56;

export const shadow = {
  shadowColor: "#161616",
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
} as const;
