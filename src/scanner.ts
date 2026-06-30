#!/usr/bin/env tsx
/**
 * scanner.ts — CLI entry point for the Polymarket multi-agent arbitrage scanner.
 *
 * Usage:
 *   npm run scan                         # single scan, print results
 *   npm run scan -- --loop               # continuous scanning (interval from .env)
 *   npm run scan -- --no-llm             # skip LLM analysis (faster, no API cost)
 *   npm run scan -- --min-score 50       # only show opportunities with score ≥ 50
 *   npm run scan -- --top 5              # show top 5 results
 *   npm run scan -- --output reports/    # also save JSON report to reports/ dir
 *   npm run scan -- --loop --interval 60 # scan every 60 seconds
 */

import 'dotenv/config'
import { runScan } from '@/lib/scanner'
import { printScanResult, saveReport } from '@/lib/scanner/formatter'
import type { ScannerConfig } from '@/lib/scanner/types'

// ── CLI argument parsing ────────────────────────────────────────────────────

const args = process.argv.slice(2)

function flag(name: string): boolean {
  return args.includes(`--${name}`)
}

function opt(name: string, fallback?: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const loop = flag('loop')
const noLlm = flag('no-llm')
const intervalSec = parseInt(opt('interval', '120') ?? '120', 10)
const minScore = parseInt(opt('min-score', '30') ?? '30', 10)
const topN = parseInt(opt('top', '20') ?? '20', 10)
const outputDir = opt('output')

const scannerCfg: Partial<ScannerConfig> = {
  runLlmAnalysis: !noLlm,
  minScore,
  maxResults: topN,
}

// ── Run ─────────────────────────────────────────────────────────────────────

async function once(): Promise<void> {
  try {
    const result = await runScan(scannerCfg)
    printScanResult(result)

    if (outputDir) {
      const file = saveReport(result, outputDir)
      console.log(`[scanner] Report saved to ${file}`)
    }
  } catch (err) {
    console.error('[scanner] Scan failed:', err)
  }
}

async function main(): Promise<void> {
  if (loop) {
    console.log(`[scanner] Loop mode — scanning every ${intervalSec}s. Press Ctrl+C to stop.`)
    // Run immediately, then on interval
    await once()
    setInterval(once, intervalSec * 1_000)
  } else {
    await once()
  }
}

main()
