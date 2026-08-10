import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        panel: "var(--panel)",
        ink: "var(--ink)",
        dim: "var(--dim)",
        faint: "var(--faint)",
        rule: "var(--rule)",
        softrule: "var(--softrule)",
        accent: "var(--accent)",
        up: "var(--up)",
        down: "var(--down)",
        amber: "var(--amber)",
      },
      fontFamily: {
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
        serif: ["var(--font-serif)", "Georgia", "'Times New Roman'", "serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
