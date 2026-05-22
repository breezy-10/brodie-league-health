import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brodie: {
          ink: "#0a0a0a",
          card: "#111111",
          line: "#1f1f1f",
          dim: "#666",
          fg: "#f5f5f5",
          accent: "#ff5b1f",
          good: "#22c55e",
          warn: "#f59e0b",
          bad: "#ef4444",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
