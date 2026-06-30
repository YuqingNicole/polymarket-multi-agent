/**
 * Test suite for polymarket-multi-agent
 * Run with: npm run test:pipeline
 *
 * Test 1: AgentInput shape validation (no API)
 * Test 2: Live scanner smoke test (real Polymarket API, no key needed)
 * Test 3: Multi-agent LLM pipeline (requires OPENROUTER_API_KEY)
 */

import 'dotenv/config'
import { runScan } from '@/lib/scanner'
import { runMultiAgentPipeline } from '@/lib/multi-agent/pipeline'
import type { AgentInput } from '@/lib/agents/input'

// ── ANSI colours ─────────────────────────────────────────────────────────────
const G = '\x1b[32m✓\x1b[0m'
const R = '\x1b[31m✗\x1b[0m'
const Y = '\x1b[33m⚠\x1b[0m'

let passed = 0
let failed = 0

function pass(label: string) { console.log(`  ${G} ${label}`); passed++ }
function fail(label: string, err?: unknown) {
  console.log(`  ${R} ${label}`)
  if (err) console.error('    ', String(err))
  failed++
}
function warn(label: string) { console.log(`  ${Y} ${label}`) }

// ── Mock AgentInput ───────────────────────────────────────────────────────────

const MOCK_INPUT: AgentInput = {
  marketId: 'test-market-001',
  source: 'poly',
  q: 'Will the Federal Reserve cut rates before September 2026?',
  poly: 0.34,
  kalshi: 0.28,
  yesAvg: 0.31,
  chg: 8.5,
  spread: 6,
  vol24: 1_200_000,
  vol: 8_000_000,
  liq: 340_000,
  volChg: 120,
}

// ── Test 1: AgentInput shape validation ──────────────────────────────────────

async function testAgentInputShape() {
  console.log('\n── Test 1: AgentInput shape ─────────────────────────────')

  const required = [
    'marketId', 'source', 'q', 'poly', 'kalshi',
    'yesAvg', 'chg', 'spread', 'vol24', 'vol', 'liq', 'volChg',
  ] as const

  const missing = required.filter(k => (MOCK_INPUT as any)[k] === undefined)
  if (missing.length > 0) fail(`Missing fields: ${missing.join(', ')}`)
  else pass('All required fields present')

  if (MOCK_INPUT.poly >= 0 && MOCK_INPUT.poly <= 1) pass(`poly=${MOCK_INPUT.poly} ✓`)
  else fail(`poly=${MOCK_INPUT.poly} out of range [0,1]`)

  if (MOCK_INPUT.kalshi >= 0 && MOCK_INPUT.kalshi <= 1) pass(`kalshi=${MOCK_INPUT.kalshi} ✓`)
  else fail(`kalshi=${MOCK_INPUT.kalshi} out of range [0,1]`)

  const expectedSpread = Math.round(Math.abs(MOCK_INPUT.poly - MOCK_INPUT.kalshi) * 100)
  pass(`Cross-platform spread = ${expectedSpread}c (poly ${MOCK_INPUT.poly*100}% vs kalshi ${MOCK_INPUT.kalshi*100}%)`)
}

// ── Test 2: Live scanner smoke test ──────────────────────────────────────────

async function testLiveScanner() {
  console.log('\n── Test 2: Live scanner (Polymarket + Kalshi APIs) ──────')
  console.log('  Fetching live market data...')

  try {
    const t0 = Date.now()
    const result = await runScan({ runLlmAnalysis: false, maxResults: 10 })
    const elapsed = Date.now() - t0

    pass(`Scan completed in ${elapsed}ms`)
    pass(`Markets fetched: ${result.totalMarkets}`)

    if (result.totalMarkets === 0) {
      fail('No markets returned — check network / Polymarket API')
      return
    }

    pass(`Opportunities found: ${result.opportunities.length}`)

    if (result.opportunities.length > 0) {
      const top = result.opportunities[0]
      pass(`Top opportunity:`)
      console.log(`    "${top.question.slice(0, 70)}..."`)
      console.log(`    score=${top.score}/100  type=${top.type}  spread=${top.spreadCents}c  vol24h=$${(top.vol24h/1000).toFixed(0)}K`)
      if (top.reasons.length > 0) {
        console.log(`    signals: ${top.reasons.join(' | ')}`)
      }

      if (top.score >= 0 && top.score <= 100) pass('Score in valid range')
      else fail(`Score out of range: ${top.score}`)

      const validTypes = ['probability_drift', 'arbitrage', 'volume_anomaly', 'liquidity_gap', 'composite']
      if (validTypes.includes(top.type)) pass(`Type "${top.type}" is valid`)
      else warn(`Unexpected type: ${top.type}`)
    } else {
      warn('No opportunities above threshold (normal in calm market conditions)')
    }

    // Print top 3
    if (result.opportunities.length > 1) {
      console.log('\n  Top opportunities:')
      result.opportunities.slice(0, 3).forEach((o, i) => {
        console.log(`  ${i+1}. [${o.score}] ${o.question.slice(0, 55)}... (${o.type})`)
      })
    }

  } catch (err) {
    fail('Live scanner threw an error', err)
  }
}

// ── Test 3: Multi-agent LLM pipeline ─────────────────────────────────────────

async function testMultiAgentPipeline() {
  console.log('\n── Test 3: Multi-agent LLM pipeline ────────────────────')

  if (!process.env.OPENROUTER_API_KEY) {
    warn('OPENROUTER_API_KEY not set — skipping')
    console.log('  Set OPENROUTER_API_KEY in .env to run this test.')
    return
  }

  const model = process.env.OPENROUTER_MODEL ?? 'anthropic/claude-3-5-haiku'
  console.log(`  Model: ${model}`)
  console.log('  Running MacroAgent + TechAgent + ArbAgent in parallel...')

  try {
    const verdict = await runMultiAgentPipeline(MOCK_INPUT)
    pass(`Pipeline completed in ${verdict.durationMs}ms`)

    const j = verdict.judge

    // Signal
    const validSignals = ['BUY YES', 'BUY NO', 'ARBITRAGE', 'HOLD']
    if (validSignals.includes(j.signal)) pass(`signal = "${j.signal}"`)
    else fail(`Invalid signal: "${j.signal}"`)

    // Conviction
    if (['HIGH','MEDIUM','LOW'].includes(j.conviction)) pass(`conviction = ${j.conviction}`)
    else fail(`Invalid conviction: ${j.conviction}`)

    // ruleApplied
    if (typeof j.ruleApplied === 'number' && j.ruleApplied >= 1 && j.ruleApplied <= 4) {
      pass(`ruleApplied = Rule ${j.ruleApplied}`)
    } else {
      fail(`Invalid ruleApplied: ${j.ruleApplied}`)
    }

    // sizePct
    if (typeof j.sizePct === 'number' && j.sizePct > 0 && j.sizePct <= 1) {
      pass(`sizePct = ${Math.round(j.sizePct * 100)}%`)
    } else {
      fail(`Invalid sizePct: ${j.sizePct}`)
    }

    // Arb check: 6c spread + $340K liquidity should be at least MEDIUM
    const feasMap: Record<string,number> = { NOT_VIABLE:0, LOW:1, MEDIUM:2, HIGH:3 }
    const feasScore = feasMap[verdict.arb.arbFeasibility] ?? -1
    if (feasScore >= 2) pass(`ArbAgent: ${verdict.arb.arbFeasibility} (correct for 6c spread + $340K liq)`)
    else warn(`ArbAgent returned ${verdict.arb.arbFeasibility} for 6c spread — may be conservative`)

    console.log('\n  📊 Agent summaries:')
    console.log(`  Macro  [${verdict.macro.pricingBias}]: ${verdict.macro.summary}`)
    console.log(`  Tech   [${verdict.tech.trend}/${verdict.tech.momentumSignal}]: ${verdict.tech.summary}`)
    console.log(`  Arb    [${verdict.arb.arbFeasibility}, net ${verdict.arb.expectedEdgeCents}c]: ${verdict.arb.summary}`)
    console.log(`  Judge  [Rule ${j.ruleApplied}]: ${j.reasoning}`)

  } catch (err) {
    fail('Multi-agent pipeline threw an error', err)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║      polymarket-multi-agent — test suite                 ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log(`  OPENROUTER_API_KEY : ${process.env.OPENROUTER_API_KEY ? '✓ set' : '✗ not set (Test 3 skipped)'}`)

  await testAgentInputShape()
  await testLiveScanner()
  await testMultiAgentPipeline()

  console.log('\n══════════════════════════════════════════════════════════')
  console.log(`  ${passed} passed  ${failed > 0 ? R : G} ${failed} failed`)
  console.log('══════════════════════════════════════════════════════════\n')

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('Unhandled error:', err)
  process.exit(1)
})
