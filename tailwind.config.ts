import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Discord-inspired dark palette. Token NAMES kept stable (ink/paper/
        // accent) so every existing bg-paper / text-ink / bg-accent usage
        // repaints automatically — only the values changed.
        ink: {
          DEFAULT: "#f2f3f5", // header/body text
          muted: "#949ba4", // secondary text
        },
        paper: {
          DEFAULT: "#313338", // main content surface
          raised: "#2b2d31", // sidebar + cards (slightly darker, like Discord's channel list)
        },
        accent: {
          DEFAULT: "#5865f2", // blurple
          soft: "rgba(88, 101, 242, 0.16)", // translucent chip/badge fill
        },
        // Recessed surface for inputs/wells — darker than paper, like
        // Discord's message box and search field.
        surface: {
          sunken: "#1e1f22",
        },
      },
      fontFamily: {
        // Discord's "gg sans" isn't ours to ship; fall back through the
        // closest widely-available look-alikes onto system UI fonts.
        heading: [
          '"gg sans"',
          "Inter",
          '"Helvetica Neue"',
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
