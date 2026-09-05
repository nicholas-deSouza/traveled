import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#10261F",
        moss: "#2E5D50",
        mist: "#EEF3EF",
        sand: "#EEE4D1",
        ember: "#E06C47"
      },
      fontFamily: {
        display: ["Georgia", "serif"],
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
} satisfies Config;
