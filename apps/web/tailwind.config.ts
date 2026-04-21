import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      colors: {
        // Premium palette
        black: '#000000',
        nearBlack: '#0a0a0a',
        aqua: '#00ffff',
        aquaDark: '#00e6e6',
        white: '#ffffff',
        // Text colors
        textPrimary: '#ffffff',
        textSecondary: '#f0f0f0',
        textMuted: '#c0c0c0',
      },
    },
  },
  plugins: [],
} satisfies Config;
