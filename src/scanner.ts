/**
 * Scanner entrypoint.
 * Usage:
 *   npx tsx src/scanner.ts          # single scan
 *   npx tsx src/scanner.ts --loop   # continuous scanning
 *   npx tsx src/scanner.ts --no-llm # scan without LLM analysis
 */

import 'dotenv/config'
import { runScan } from '@/lib/scanner'
import { formatOpportunities } from '@/lib/scanner/formatter'

const args = process.argv.slice(2)
const isLoop = args.includes('--loop')
const noLlm = args.includes('--no-llm')

const INTERVAL_SEC = parseInt(process.env.SCANNER_INTERVAL_SEC ?? '120', 10)

async function scan() {
  const t0 = Date.now()
  console.log(`\n[${new Date().toISOString()}] Starting scan...`)

  try {
    const result = await runScan({
      runLlmAnalysis: !noLlm,
      maxResults: parseInt(process.env.SCANNER_MAX_RESULTS ?? '20', 10),
      minVol24h: parseInt(process.env.SCANNER_MIN_VOL24H ?? '5000', 10),
      minScore: parseInt(process.env.SCANNER_MIN_SCORE ?? '30', 10),
      llmTopN: parseInt(process.env.SCANNER_LLM_TOP_N ?? '3', 10),
    })

    formatOpportunities(result)
    console.log(`\nScan done in ${Date.now() - t0}ms`)
  } catch (err) {
    console.error('[scanner] Error:', err)
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗')
  console.log('║      polymarket-multi-agent scanner                  ║')
  console.log('╚══════════════════════════════════════════════════════╝')
  console.log(`Mode   : ${isLoop ? `loop (every ${INTERVAL_SEC}s)` : 'single run'}`)
  console.log(`LLM    : ${noLlm ? 'disabled' : 'enabled'}`)
  console.log(`Model  : ${process.env.OPENROUTER_MODEL ?? 'anthropic/claude-3-5-haiku'}`)

  await scan()

  if (isLoop) {
    setInterval(scan, INTERVAL_SEC * 1000)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
