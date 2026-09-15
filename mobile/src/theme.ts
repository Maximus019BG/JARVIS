import { StyleSheet } from "react-native"

/**
 * The drafting palette the web app uses, not a Marvel one: square corners, a paper ground and
 * a rule-blue accent. `globals.css` zeroes every border radius for the same reason.
 */
export const colors = {
  bg: "#0e1116",
  panel: "#161b22",
  line: "#262d38",
  text: "#e6edf3",
  muted: "#8b949e",
  dim: "#565f6b",
  accent: "#4c8eda",
  warn: "#d29922",
  danger: "#da5c5c",
  ok: "#3fb950",
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  heading: { color: colors.text, fontSize: 22, fontWeight: "600", marginBottom: 4 },
  sub: { color: colors.muted, fontSize: 13, marginBottom: 20 },
  label: { color: colors.muted, fontSize: 12, marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 },
  input: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 14,
    fontSize: 16,
  },
  button: { backgroundColor: colors.accent, paddingVertical: 14, alignItems: "center" },
  buttonText: { color: "#ffffff", fontWeight: "600", fontSize: 16 },
  ghost: { borderWidth: 1, borderColor: colors.line, paddingVertical: 12, alignItems: "center" },
  ghostText: { color: colors.muted, fontSize: 14 },
  card: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, padding: 14, marginBottom: 10 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  cardMeta: { color: colors.dim, fontSize: 12, marginTop: 4 },
  error: { color: colors.danger, fontSize: 13, marginBottom: 12 },
  mono: { color: colors.muted, fontSize: 12, fontFamily: "monospace" },
  row: { flexDirection: "row", gap: 10 },
})
