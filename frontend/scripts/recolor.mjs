// Seasonal recolor codemod.
// Rewrites the previous season's brand colours across src/ to the current
// THEME values from src/lib/theme.js. Handles hex values (any case) and
// rgba()/rgb() triplets. Run from the frontend folder: `node scripts/recolor.mjs`
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { THEME, PREVIOUS_THEME } from '../src/lib/theme.js'

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

// token: [previousHex, newHex]. accentAlt folds into accent (2027 has one coral).
const pairs = [
  [PREVIOUS_THEME.brand, THEME.brand],
  [PREVIOUS_THEME.accent, THEME.accent],
  [PREVIOUS_THEME.accentAlt, THEME.accent],
  // highlight and ink unchanged this season; add pairs here when they change.
]

const replacements = []
for (const [from, to] of pairs) {
  if (from.toLowerCase() === to.toLowerCase()) continue
  replacements.push([new RegExp(from.replace('#', '#'), 'gi'), to])
  const [r1, g1, b1] = hexToRgb(from)
  const [r2, g2, b2] = hexToRgb(to)
  replacements.push([new RegExp(`rgba\\(${r1},\\s*${g1},\\s*${b1},`, 'g'), `rgba(${r2}, ${g2}, ${b2},`])
  replacements.push([new RegExp(`rgb\\(${r1},\\s*${g1},\\s*${b1}\\)`, 'g'), `rgb(${r2}, ${g2}, ${b2})`])
}

const exts = new Set(['.js', '.jsx', '.css'])
let changedFiles = 0
let totalReplacements = 0

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { walk(p); continue }
    if (!exts.has(extname(name))) continue
    if (p.endsWith('lib/theme.js')) continue // the token source itself
    let src = readFileSync(p, 'utf8')
    let count = 0
    for (const [re, to] of replacements) {
      src = src.replace(re, (...args) => { count++; return to })
    }
    if (count > 0) {
      writeFileSync(p, src)
      changedFiles++
      totalReplacements += count
      console.log(`${p}: ${count} replacements`)
    }
  }
}

walk('src')
console.log(`Done: ${totalReplacements} replacements in ${changedFiles} files.`)
