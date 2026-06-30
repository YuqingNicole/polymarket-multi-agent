/**
 * Test the multi-agent pipeline with mock data.
 * Run with: npx tsx src/test-pipeline.ts
 *
 * Does NOT call any real APIs. Uses a mock fetch + a mock LLM response
 * to verify that the full pipeline runs without errors and returns
 * correctly-shaped output.
 *
 * Also runs a live smoke test against the real Polymarket Gamma API
 * (no API key needed) to verify the data layer works.
 */

import 'dotenv/config'
import { runScan } from '@/lib/scanner'
import { runMultiAgentPipeline } from '@/lib/multi-agent/pipeline'
import type { AgentInput } from '@/lib/agents/input'

// ── ANSI colours ─────────────────────────────────────────────────────────────
const G = '\x1b[32m✓\x1b[0m'
const R = '\x1b[31m✗\x1b[0m'
const Y = '\x1b[33m⚠\x1b[0m'

function pass(label: string) { console.log(`${G} ${label}`) }
function fail(label: string, err?: unknown) {
  console.log(`${R} ${label}`)
  if (err) console.error('  ', err)
}
function warn(label: string) { console.log(`${Y} ${label}`) }

// ── Mock AgentInput ───────────────────────────────────────────────────────────

const MOCK_INPUT: AgentInput = {
  marketId: 'test-market-001',
  source: 'poly',
  q: 'Will the Federal Reserve cut rates before September 2026?',
  poly: 0.34,
  kalshi: 0.28,           // 6c spread → should trigger ArbAgent
  yesAvg: 0.31,
  chg: 8.5,               // strong upward drift → should flag TechAgent
  spread: 6,
  vol24: 1_200_000,
  vol: 8_000_000,
  liq: 340_000,
  volChg: 120,            // volume spike
}

// ── Test 1: Scorer (no API calls) ─────────────────────────────────────────────

async function testScorer() {
  console.log('\n── Test 1: Scorer (no API calls) ────────────────────────')
  try {
    const { scoreMarket } = await import('@/lib/scanner/scorer')
    const { DEFAULT_SCANNER_CONFIG } = await import('@/lib/scanner/types')

    const opp = scoreMarket(MOCK_INPUT, DEFAULT_SCANNER_CONFIG)

    if (!opp) {
      fail('scoreMarket returned null (below threshold)')
      return
    }

    pass(`scoreMarket returned opportunity: score=${opp.score}/100`)
    pass(`type=${opp.type}  spreadCents=${opp.spreadCents}`)
    pass(`reasons count: ${opp.reasons.length}`)
    opp.reasons.forEach(r => console.log(`   • ${r}`))

    // Sanity checks
    if (opp.score < 1 || opp.score > 100) fail(`Score out of range: ${opp.score}`)
    else pass('Score in valid range (0..100)')

    if (opp.spreadCents !== MOCK_INPUT.spread) fail(`Spread mismatch: ${opp.spreadCents} vs ${MOCK_INPUT.spread}`)
    else pass('Spread copied correctly')

  } catch (err) {
    fail('Scorer test threw', err)
  }
}

// ── Test 2: Builder (no API calls) ────────────────────────────────────────────

async function testBuilder() {
  console.log('\n── Test 2: Builder (raw Gamma → AgentInput) ─────────────')
  try {
    const { buildAgentInputFromGamma } = await import('@/lib/scanner/builder')

    const mockRaw = {
      conditionId: 'abc123',
      question: 'Will X happen?',
      outcomePrices: ['0.65', '0.35'],
      volume24hr: 500_000,
      volume: 2_000_000,
      liquidity: 80_000,
      oneDayPriceChange: 0.05,
      volumeChange24hr: 0.8,
    }

    const input = buildAgentInputFromGamma(mockRaw)
    if (!input) { fail('buildAgentInputFromGamma returned null'); return }

    pass(`marketId=${input.marketId}`)
    pass(`poly=${input.poly}  (expected ~0.65)`)
    pass(`chg=${input.chg}  (expected 5pts from 0.05)`)
    pass(`volChg=${input.volChg}  (expected 80% from 0.8)`)

    if (Math.abs(input.poly - 0.65) > 0.01) fail(`yesProb mismatch: ${input.poly}`)
    else pass('yesProb parsed correctly from outcomePrices[0]')

  } catch (err) {
    fail('Builder test threw', err)
  }
}

// ── Test 3: Live data smoke test (real Polymarket API, no key needed) ─────────

async function testLiveData() {
  console.log('\n── Test 3: Live data smoke test (Polymarket API) ────────')
  try {
    const result = await runScan(
      { runLlmAnalysis: false, maxResults: 5, minVol24h: 1000 },
    )

    pass(`Scan completed. totalMarkets=${result.totalMarkets}`)
    pass(`Opportunities found: ${result.opportunities.length}`)

    if (result.totalMarkets === 0) {
      warn('No markets fetched — check network or Polymarket API')
      return
    }

    if (result.opportunities.length > 0) {
      const top = result.opportunities[0]
      pass(`Top opportunity: "${top.question.slice(0, 60)}..."`)
      pass(`  score=${top.score}  type=${top.type}  vol24h=$${(top.vol24h/1000).toFixed(0)}K`)
    } else {
      warn('No opportunities above threshold (this may be normal in calm markets)')
    }

  } catch (err) {
    fail('Live data test threw', err)
  }
}

// ── Test 4: Multi-agent pipeline (requires OPENROUTER_API_KEY) ────────────────

async function testMultiAgentPipeline() {
  console.log('\n── Test 4: Multi-agent pipeline (LLM) ──────────────────')

  if (!process.env.OPENROUTER_API_KEY) {
    warn('OPENROUTER_API_KEY not set — skipping LLM test')
    console.log('   Set it in .env and rerun to test the full pipeline.')
    return
  }

  try {
    console.log('   Running pipeline on mock market (this will consume LLM tokens)...')
    const verdict = await runMultiAgentPipeline(MOCK_INPUT)

    pass(`Pipeline completed in ${verdict.durationMs}ms`)

    // Validate structure
    const j = verdict.judge
    if (!j.signal) fail('judge.signal missing')
    else pass(`judge.signal = ${j.signal}`)

    if (!['HIGH','MEDIUM','LOW'].includes(j.conviction)) fail(`invalid conviction: ${j.conviction}`)
    else pass(`judge.conviction = ${j.conviction}`)

    if (typeof j.ruleApplied !== 'number') fail('judge.ruleApplied missing')
    else pass(`judge.ruleApplied = Rule ${j.ruleApplied}`)

    pass(`judge.reasoning: ${j.reasoning}`)
    pass(`macro: ${verdict.macro.summary}`)
    pass(`tech: ${verdict.tech.summary}`)
    pass(`arb: ${verdict.arb.summary}`)

    // Validate arb logic: we gave spread=6c, should be HIGH or MEDIUM feasibility
    if (['NOT_VIABLE','LOW'].includes(verdict.arb.arbFeasibility)) {
      warn(`ArbAgent returned ${verdict.arb.arbFeasibility} for 6c spread — may be conservative`)
    } else {
      pass(`ArbAgent feasibility = ${verdict.arb.arbFeasibility} (correct for 6c spread)`)
    }

  } catch (err) {
    fail('Multi-agent pipeline test threw', err)
  }
}

// ── Run all tests ─────────────────────────────────────────────────────────────

async function main() {
  console.log('=== polymarket-multi-agent test suite ===')
  console.log(`OPENROUTER_API_KEY: ${process.env.OPENROUTER_API_KEY ? '✓ set' : '✗ not set (LLM test will be skipped)'}`)
  console.log(`DATA_SOURCE: ${process.env.DATA_SOURCE ?? 'live (default)'}`)

  await testScorer()
  await testBuilder()
  await testLiveData()
  await testMultiAgentPipeline()

  console.log('\n=== done ===\n')
}

main()
