import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ── Sonic Architect · Surface Hierarchy ──────────────────────
        "surface":                   "#060e20",
        "surface-dim":               "#060e20",
        "surface-bright":            "#172b54",
        "surface-container-lowest":  "#000000",
        "surface-container-low":     "#081329",
        "surface-container":         "#0c1934",
        "surface-container-high":    "#101e3e",
        "surface-container-highest": "#142449",
        "surface-variant":           "#142449",
        "inverse-surface":           "#faf8ff",
        // ── On‑surface ───────────────────────────────────────────────
        "on-surface":         "#dee5ff",
        "on-surface-variant": "#9baad6",
        "inverse-on-surface": "#4d556b",
        "on-background":      "#dee5ff",
        // ── Background ──────────────────────────────────────────────
        "background": "#060e20",
        // ── Primary (blue) ───────────────────────────────────────────
        "primary":                  "#699cff",
        "primary-dim":              "#699cff",
        "primary-fixed":            "#a5c1ff",
        "primary-fixed-dim":        "#8fb3ff",
        "primary-container":        "#4388fd",
        "on-primary":               "#001e4a",
        "on-primary-fixed":         "#002659",
        "on-primary-fixed-variant": "#004292",
        "on-primary-container":     "#000311",
        "inverse-primary":          "#005bc4",
        "surface-tint":             "#699cff",
        // ── Secondary (purple) ───────────────────────────────────────
        "secondary":                  "#d0bcff",
        "secondary-dim":              "#8455ef",
        "secondary-fixed":            "#e9ddff",
        "secondary-fixed-dim":        "#ddcdff",
        "secondary-container":        "#2f0076",
        "on-secondary":               "#4e03b8",
        "on-secondary-fixed":         "#4d00b7",
        "on-secondary-fixed-variant": "#6a37d4",
        "on-secondary-container":     "#b192ff",
        // ── Tertiary (pink) ──────────────────────────────────────────
        "tertiary":                  "#fbabff",
        "tertiary-dim":              "#ec63ff",
        "tertiary-fixed":            "#f795ff",
        "tertiary-fixed-dim":        "#f27dff",
        "tertiary-container":        "#f795ff",
        "on-tertiary":               "#710082",
        "on-tertiary-fixed":         "#3e0048",
        "on-tertiary-fixed-variant": "#700081",
        "on-tertiary-container":     "#620070",
        // ── Outline ──────────────────────────────────────────────────
        "outline":         "#65759e",
        "outline-variant": "#38476d",
        // ── Error ────────────────────────────────────────────────────
        "error":           "#fd6f85",
        "error-dim":       "#c8475d",
        "error-container": "#8a1632",
        "on-error":        "#490013",
        "on-error-container": "#ff97a3",
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        sm:  "0.5rem",
        md:  "0.75rem",
        lg:  "1rem",
        xl:  "1.5rem",
        "2xl": "2rem",
        full: "9999px",
      },
      fontFamily: {
        sans:     ["Inter", "system-ui", "sans-serif"],
        headline: ["Inter", "system-ui", "sans-serif"],
        body:     ["Inter", "system-ui", "sans-serif"],
        label:    ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
