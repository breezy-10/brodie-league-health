import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        brodie: {
          orange: "#FFB800",
          gold: "#FFB800",
          ink: "#0E0E0E",
          cream: "#FFF7EE",
        },
        glass: {
          bg: "var(--glass-background)",
          surface: "var(--glass-surface)",
          "surface-hover": "var(--glass-surface-hover)",
          "surface-active": "var(--glass-surface-active)",
          border: "var(--glass-border)",
          "border-light": "var(--glass-border-light)",
          text: "var(--glass-text)",
          "text-secondary": "var(--glass-text-secondary)",
          "text-tertiary": "var(--glass-text-tertiary)",
          gold: "var(--glass-gold)",
          red: "var(--glass-red)",
          green: "var(--glass-green)",
          blue: "var(--glass-blue)",
          yellow: "var(--glass-yellow)",
          purple: "var(--glass-purple)",
        },
      },
      // The kit's card radius and shadow, so a Tailwind card matches a br- one.
      borderRadius: {
        "2xl": "var(--radius-card)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-plex-mono)", "IBM Plex Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
