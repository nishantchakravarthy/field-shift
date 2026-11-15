import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0E1111",
        panel: "#161A1A",
        line: "#2A3030",
        fg: "#E8E6E1",
        mute: "#9AA19E",
        amber: "#E0A43A",
        rust: "#B5502D",
        teal: "#2E8C86",
        soil: "#5A3A22",
        ochre: "#C9A227",
        crop: "#3F8F4F",
      },
      fontFamily: {
        sans: ["var(--font-plex-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        micro: ["12px", "16px"],
        sm: ["14px", "20px"],
        base: ["16px", "24px"],
        lg: ["20px", "28px"],
        xl: ["32px", "38px"],
        hero: ["56px", "60px"],
      },
      borderRadius: { DEFAULT: "6px" },
    },
  },
  plugins: [],
};
export default config;
