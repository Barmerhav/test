/**
 * LEMATA design system — theme "6a גרפיט וירוק שקט" from the "Lemata App UI"
 * canvas. Visual constants only; business values live in the config table.
 */

/** RESIDENT — light. */
export const colors = {
  bg: "#FAFAF8",
  card: "#FFFFFF",
  surface: "#F1F2F0",
  surfaceAlt: "#EFF1EC",
  line: "#E2E5E0",
  lineSoft: "#E7E9E4",
  lineAlt: "#E5E8E3",
  ink: "#212528",
  inkDeep: "#22302A",
  text2: "#575D5B",
  muted: "#87908A",
  faint: "#A2AAA4",
  faint2: "#ADB5AE",
  green: "#3E7E62",
  greenDeep: "#2F6B51",
  mint: "#E1EEE7",
  mintAlt: "#E3EFE8",
  mintCard: "#E9F2EC",
  mintCardBorder: "#C6DFD1",
  mintSoft: "#F4FAF6",
  mintField: "#F5FAF7",
  mintDashed: "#9CC5AE",
  greenLight: "#7BC9A3",
  onGreen: "#F2F8F4",
  onGreenAlt: "#F4FAF6",
  onGreenDim: "rgba(244,250,246,.72)",
  danger: "#B0483F",
  ringTrack: "#E6E9E4",
  progressTrack: "#ECEFE9",
  pillNeutralBg: "#EDEEEA",
  pillNeutralText: "#4F555A",
  pillOutBg: "#FFF1CC",
  pillOutText: "#7A5300",
  pillCreditBg: "#EBEDE8",
  pillCreditText: "#6E6A61",
  pillWaitBorder: "#C4BCA9",
  pillWaitText: "#8B8474",
  scrim: "rgba(33,37,40,.38)",
  tabBg: "rgba(255,255,255,.94)",
  shadowGreen: "rgba(62,126,98,.25)",
  shadowGreenBig: "rgba(62,126,98,.42)",
  shadowInk: "rgba(33,37,40,.06)",
  // kept for the resident-mode ring/avatars
  avatarSoft: "#A8CBBB",
} as const;

/** PICKER — night graphite. */
export const pickerColors = {
  bg: "#2A2E33",
  deep: "#212528",
  surface: "#33383E",
  elevated: "#3A4046",
  chip: "#3C4249",
  line: "#3F454C",
  lineStrong: "#4A5158",
  lineLoud: "#535A62",
  text: "#F1F2F0",
  textBright: "#FAFAF8",
  muted: "#A6ACB2",
  faint: "#787F87",
  faint2: "#7C838B",
  soft: "#C8CDD2",
  green: "#7BC9A3",
  money: "#8FD9B4",
  greenSoft: "#7FD1A8",
  onGreen: "#0F241A",
  timerBg: "#24463A",
  timerText: "#9FE0BF",
  danger: "#FF6B57",
  tabBg: "rgba(16,18,21,.96)",
  tabBorder: "#3A4046",
  glow: "rgba(143,217,180,.3)",
  glowSoft: "rgba(143,217,180,.1)",
  badgeBg: "rgba(127,209,168,.14)",
  ink: "#161616",
} as const;

export const fonts = {
  regular: "Heebo_400Regular",
  medium: "Heebo_500Medium",
  semibold: "Heebo_600SemiBold",
  bold: "Heebo_700Bold",
  heavy: "Heebo_800ExtraBold",
  black: "Heebo_900Black",
  mono: "JetBrainsMono_500Medium",
  monoBold: "JetBrainsMono_700Bold",
  monoHeavy: "JetBrainsMono_800ExtraBold",
} as const;

export const radii = {
  card: 18,
  cardBig: 22,
  button: 14,
  buttonBig: 18,
  chip: 12,
  pill: 99,
  field: 12,
} as const;

/** Minimum tap targets. */
export const TAP = 48;
export const PICKER_TAP = 56;

export const shadow = {
  shadowColor: "#212528",
  shadowOpacity: 0.06,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
} as const;

export const greenShadow = {
  shadowColor: "#3E7E62",
  shadowOpacity: 0.32,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 6 },
  elevation: 5,
} as const;

export const darkGreenShadow = {
  shadowColor: "#7BC9A3",
  shadowOpacity: 0.3,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 6 },
  elevation: 5,
} as const;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
} as const;
