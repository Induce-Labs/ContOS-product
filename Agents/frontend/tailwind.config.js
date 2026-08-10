/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f1419",
        paper: "#f7f4ef",
        mist: "#e8e2d8",
        accent: "#1a6b5c",
        accentSoft: "#2a9d8f",
        warn: "#c45c26",
        line: "#d4cdc2",
      },
      fontFamily: {
        display: ['"Fraunces"', "Georgia", "serif"],
        sans: ['"DM Sans"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        soft: "0 12px 40px rgba(15, 20, 25, 0.08)",
      },
    },
  },
  plugins: [],
};
