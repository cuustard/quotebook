import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Warm, paper-like palette for a "notebook" feel.
        ink: {
          DEFAULT: "#1f2421",
          muted: "#5b635d",
        },
        paper: {
          DEFAULT: "#fbf9f4",
          raised: "#ffffff",
        },
        accent: {
          DEFAULT: "#b8542a",
          soft: "#f3e4dc",
        },
      },
      fontFamily: {
        serif: ["Georgia", "Cambria", "Times New Roman", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
