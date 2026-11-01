// That Triathlon Life — theme tokens (single source of truth).
//
// The app is ONE unified brand app with two live themes (DESIGN-SPEC §3,
// dual-theme amendment 2026-10-31):
//   - BRAND_THEME — the TTL masterbrand, shown to Fan/Community users.
//     Aqua + sun gold, drawn from the sun-and-waves mark (the masterbrand
//     site is monochrome editorial; the mark carries the colour).
//   - TEAM_THEME (THEME) — the season's Team TTL kit palette, shown to
//     team-entitled members. Annual recoloring is a standing requirement:
//     team colours change every season.
// Components never hard-code palette hexes: they use the CSS variables
// (--brand / --accent / --highlight and their -rgb triplets) defined in
// src/index.css, and App switches <html data-theme> by tier. Seasonal
// recolor = update TEAM_THEME + the [data-theme="team"] block in index.css.
//
// Season: 2027 (palette sampled from the supplied 2027 logo/palette sheet;
// swap in the official designer hexes when they arrive — see brand-2027 notes).

export const BRAND_THEME = {
  brand: '#2BB3A3', // masterbrand aqua (deeper/greener than the kit teal)
  accent: '#E9C46A', // sun gold — the warm accent role, from the mark's sun
  highlight: '#E8B84B', // shared sun gold
  ink: '#1F212D',
  paper: '#FFFFFF',
}

export const TEAM_THEME = {
  brand: '#00B5B9', // primary teal (2027)
  accent: '#E87362', // coral (2027)
  highlight: '#E8B84B', // warm highlight (carried over; no 2027 equivalent sampled yet)
  ink: '#1F212D', // checker/ink dark (2027)
  paper: '#FFFFFF',
}

// Back-compat alias (recolor.mjs and older imports reference THEME).
export const THEME = TEAM_THEME

// The previous season's values, kept so recolor.mjs can find and replace them.
export const PREVIOUS_THEME = {
  brand: '#00C4B4',
  accent: '#FF3D8B',
  accentAlt: '#FF5A1F',
  highlight: '#E8B84B',
  ink: '#111111',
}
