/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cb: {
          bg:         "#0B0B0B",
          panel:      "#141414",
          border:     "#252525",
          blue:       "#0EA5E9",
          "blue-dim": "#0369A1",
          amber:      "#F59E0B",
          red:        "#EF4444",
          green:      "#22C55E",
          muted:      "#6B7280",
          secondary:  "#9CA3AF",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
