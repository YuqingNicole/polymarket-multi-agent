// Extracts the prototype's CSS, fonts, and body markup into the Next app so the
// terminal UI reuses the original styling + layout verbatim.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve('.')
const TPL = path.resolve('docs/prototype/extracted/template.html')
const RES = path.resolve('docs/prototype/extracted/resources')
const FONTS_OUT = path.resolve('public/fonts')
const CSS_OUT = path.resolve('src/app/globals.css')
const MARKUP_OUT = path.resolve('src/components/terminal/markup.ts')

fs.mkdirSync(FONTS_OUT, { recursive: true })
fs.mkdirSync(path.dirname(MARKUP_OUT), { recursive: true })

const html = fs.readFileSync(TPL, 'utf8')

// --- 1. CSS: both <style> blocks (fonts + design tokens/base/keyframes) ---
const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1])
let css = styles.join('\n\n')

// rewrite url("<uuid>") -> url("/fonts/<uuid>.woff2") and copy the woff2 files
const used = new Set()
css = css.replace(/url\("([0-9a-f-]{36})"\)/g, (_, uuid) => {
  used.add(uuid)
  return `url("/fonts/${uuid}.woff2")`
})
for (const uuid of used) {
  const src = path.join(RES, `${uuid}.woff2`)
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(FONTS_OUT, `${uuid}.woff2`))
  else console.warn('missing font', uuid)
}
fs.writeFileSync(CSS_OUT, css + '\n')
console.log(`globals.css ${css.length} chars · ${used.size} fonts copied`)

// --- 2. body markup: between </helmet> and the x-dc logic script ---
const start = html.indexOf('</helmet>') + '</helmet>'.length
const end = html.indexOf('<script type="text/x-dc"')
let markup = html.slice(start, end)
// drop the wrapping </x-dc> / stray closing tags, keep the grid root
markup = markup.replace(/<\/x-dc>/g, '').trim()
fs.writeFileSync(
  MARKUP_OUT,
  '// AUTO-GENERATED from the prototype body (docs/prototype/build-ui-assets.mjs). Do not edit.\n' +
    '/* eslint-disable */\n' +
    `export const TERMINAL_MARKUP = ${JSON.stringify(markup)}\n`,
)
console.log(`markup.ts ${markup.length} chars`)
