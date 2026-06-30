// Formatter: converts ScanResult into human-readable console output and JSON reports.

import type { ScanResult, ArbitrageOpportunity } from './types'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Print a scan result to stdout in a readable table format.
 */
export function printScanResult(result: ScanResult): void {
  const bar = '═'.repeat(80)
  const thin = '─'.repeat(80)

  console.log(`\n${bar}`)
  console.log(` POLYMARKET ARBITRAGE SCANNER`)
  console.log(` Scan time : ${result.scannedAt}`)
  console.log(` Markets   : ${result.totalMarkets} scanned → ${result.opportunities.length} opportunities found`)
  console.log(bar)

  if (result.opportunities.length === 0) {
    console.log(' No opportunities found above threshold.\n')
    return
  }

  result.opportunities.forEach((opp, idx) => {
    console.log(`\n #${String(idx + 1).padStart(2, '0')}  ${opp.question.slice(0, 70)}`)
    console.log(thin)
    console.log(
      ` Score: ${opp.score}/100  │  Type: ${opp.type}  │  Source: ${opp.source}`,
    )
    console.log(
      ` Prob:  Poly ${pct(opp.polyProb)}  │  Kalshi ${pct(opp.kalshiProb)}  │  Spread: ${opp.spreadCents}c`,
    )
    console.log(
      ` Vol24h: $${fmtUsd(opp.vol24h)}  │  Liquidity: $${fmtUsd(opp.liq)}  │  Δprob: ${opp.probChg24h > 0 ? '+' : ''}${opp.probChg24h.toFixed(1)}pts`,
    )
    if (opp.reasons.length > 0) {
      console.log(` Signals:`)
      opp.reasons.forEach((r) => console.log(`   • ${r}`))
    }
    const analysis = (opp as any).llmAnalysis
    if (analysis?.judge) {
      const j = analysis.judge
      console.log(
        ` ┌─ 裁判裁决: ${j.signal}  置信度: ${j.conviction}  共识: ${j.consensusLevel}`,
      )
      console.log(` │  主导 Agent: ${j.dominantAgent}  建议仓位: ${Math.round(j.sizePct * 100)}%`)
      console.log(` │  理由: ${j.reasoning}`)
      if (analysis.macro?.summary) console.log(` │  宏观: ${analysis.macro.summary}`)
      if (analysis.tech?.summary) console.log(` │  技术: ${analysis.tech.summary}`)
      if (analysis.arb?.summary) console.log(` └─ 套利: ${analysis.arb.summary}`)
    } else if (analysis) {
      console.log(` LLM Decision: ${analysis.decision ?? '—'}`)
    }
  })

  console.log(`\n${bar}\n`)
}

/**
 * Save scan result as a JSON report to the reports/ directory.
 * Returns the file path written.
 */
export function saveReport(result: ScanResult, dir = 'reports'): string {
  fs.mkdirSync(dir, { recursive: true })
  const ts = result.scannedAt.replace(/[:.]/g, '-').slice(0, 19)
  const filename = path.join(dir, `scan-${ts}.json`)
  fs.writeFileSync(filename, JSON.stringify(result, null, 2), 'utf-8')
  return filename
}

// --- helpers ----------------------------------------------------------------

function pct(p: number): string {
  return (p * 100).toFixed(1) + '%'
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
  return n.toFixed(0)
}
