import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'

const OUT = path.resolve('docs/prototype/shots')
fs.mkdirSync(OUT, { recursive: true })
const ORIG = 'file://' + path.resolve('docs/prototype/Augur-Terminal.html')
const PORT = 'http://localhost:3939'

const screens = [
  { name: 'dashboard', nav: null },
  { name: 'detail', nav: '标的详情' },
  { name: 'agent', nav: 'Agent 分析' },
  { name: 'signals', nav: '异常信号' },
]

async function capture(page, base, prefix) {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1800)
  for (const s of screens) {
    if (s.nav) {
      await page.getByRole('button', { name: s.nav }).first().click().catch(() => {})
      await page.waitForTimeout(700)
    }
    await page.screenshot({ path: path.join(OUT, `${prefix}-${s.name}.png`) })
    // back to dashboard for next nav
    await page.getByRole('button', { name: '市场总览' }).first().click().catch(() => {})
    await page.waitForTimeout(400)
  }
  // layout B on dashboard
  await page.getByRole('button', { name: 'B · 监控卡' }).first().click().catch(() => {})
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(OUT, `${prefix}-layoutB.png`) })
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1460, height: 900 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log(`[${'pageerror'}]`, e.message))
const which = process.argv[2] || 'both'
if (which === 'orig' || which === 'both') await capture(page, ORIG, 'orig')
if (which === 'port' || which === 'both') await capture(page, PORT, 'port')
await browser.close()
console.log('shots written to', OUT)
