// Team TTL — seasonal theme tokens (single source of truth).
//
// Annual recoloring is a standing design requirement: team colours change
// every season. To recolor the app for a new season:
//   1. Update the values in THEME below to the new season's palette.
//   2. Run `node scripts/recolor.mjs` from the frontend folder — it rewrites
//      the previous season's hex/RGB values across src/ to the new ones.
//   3. Update the matching CSS variables in src/index.css (:root block).
// Never hard-code a brand hex elsewhere; add it here as a token instead.
//
// Season: 2027 (palette sampled from the supplied 2027 logo/palette sheet;
// swap in the official designer hexes when they arrive — see brand-2027 notes).

export const THEME = {
  brand: '#00B5B9', // primary teal (2027)
  accent: '#E87362', // coral (2027)
  highlight: '#E8B84B', // warm highlight (carried over; no 2027 equivalent sampled yet)
  ink: '#1F212D', // checker/ink dark (2027)
  paper: '#FFFFFF',
}

// The previous season's values, kept so recolor.mjs can find and replace them.
export const PREVIOUS_THEME = {
  brand: '#00C4B4',
  accent: '#FF3D8B',
  accentAlt: '#FF5A1F',
  highlight: '#E8B84B',
  ink: '#111111',
}
