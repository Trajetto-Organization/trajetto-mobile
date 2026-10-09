const plugin = require("tailwindcss/plugin");

const { cssVariables } = require("./utils/theme-tokens");

/** `rgb(var(--color-ink) / <alpha-value>)`: a token that takes `/50` opacity. */
const token = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  // The theme store picks the scheme (light, dark or the system's) and hands
  // it to NativeWind's colorScheme.set, which "media" mode refuses.
  darkMode: "class",
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./providers/**/*.{js,jsx,ts,tsx}",
    "./hooks/**/*.{js,jsx,ts,tsx}",
    "./utils/**/*.{js,jsx,ts,tsx}",
    "./store/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Semantic tokens (docs/arquitetura.md, theme section). Each one is a CSS variable that
        // flips with the scheme, so a theme switch restyles only the views
        // that read it, with no tree re-render. The numbered scales below
        // are the old light-only shades, kept until every screen converts.
        background: token("background"),
        surface: token("surface"),
        card: token("card"),
        subtle: token("subtle"),
        ink: {
          DEFAULT: token("ink"),
          soft: token("ink-soft"),
        },
        muted: token("muted"),
        border: token("border"),
        input: token("input"),
        destructive: {
          DEFAULT: token("destructive"),
          foreground: token("destructive-foreground"),
          soft: token("destructive-soft"),
        },
        deliveries: {
          DEFAULT: token("deliveries"),
          soft: token("deliveries-soft"),
        },
        fleet: {
          DEFAULT: token("fleet"),
          soft: token("fleet-soft"),
        },
        primary: {
          DEFAULT: token("primary"),
          foreground: token("primary-foreground"),
          soft: token("primary-soft"),
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
        },
        gray: {
          50: "#f9fafb",
          100: "#f3f4f6",
          200: "#e5e7eb",
          300: "#d1d5db",
          400: "#9ca3af",
          500: "#6b7280",
          600: "#4b5563",
          700: "#374151",
          800: "#1f2937",
          900: "#111827",
        },
        success: {
          DEFAULT: token("success"),
          foreground: token("success-foreground"),
          soft: token("success-soft"),
          50: "#f0fdf4",
          100: "#dcfce7",
          200: "#bbf7d0",
          300: "#86efac",
          400: "#4ade80",
          500: "#22c55e",
          600: "#16a34a",
          700: "#15803d",
          800: "#166534",
          900: "#14532d",
        },
        danger: {
          50: "#fef2f2",
          100: "#fee2e2",
          200: "#fecaca",
          300: "#fca5a5",
          400: "#f87171",
          500: "#ef4444",
          600: "#dc2626",
          700: "#b91c1c",
          800: "#991b1b",
          900: "#7f1d1d",
        },
        warning: {
          DEFAULT: token("warning"),
          foreground: token("warning-foreground"),
          soft: token("warning-soft"),
          50: "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
          800: "#92400e",
          900: "#78350f",
        },
      },
      // `bg-primary` is the deep surface behind white text; `text-primary`
      // and `border-primary` the readable colour above. They differ in the
      // dark theme only (utils/theme-tokens.js), like the web's destructive.
      backgroundColor: {
        primary: { DEFAULT: token("primary-surface") },
        destructive: { DEFAULT: token("destructive-surface") },
        success: { DEFAULT: token("success-surface") },
        warning: { DEFAULT: token("warning-surface") },
        deliveries: { DEFAULT: token("deliveries-surface") },
        fleet: { DEFAULT: token("fleet-surface") },
      },
      fontFamily: {
        inter: ["Inter", "sans-serif"],
      },
      animation: {
        "fade-in": "fadeIn 0.5s ease-in-out",
        "slide-in": "slideIn 0.3s ease-out",
        "bounce-gentle": "bounceGentle 0.6s ease-out",
        shimmer: "shimmer 1.5s infinite linear",
        pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideIn: {
          "0%": { transform: "translateY(20px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        bounceGentle: {
          "0%, 20%, 53%, 80%, 100%": { transform: "translate3d(0,0,0)" },
          "40%, 43%": { transform: "translate3d(0,-15px,0)" },
          "70%": { transform: "translate3d(0,-7px,0)" },
          "90%": { transform: "translate3d(0,-2px,0)" },
        },
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
    },
  },
  plugins: [
    // The variables themselves, from the same object the app reads for
    // colour props. `.dark:root` is the selector NativeWind maps to its dark
    // scheme under darkMode "class".
    plugin(({ addBase }) => {
      addBase({
        ":root": cssVariables("light"),
        ".dark:root": cssVariables("dark"),
      });
    }),
  ],
};
