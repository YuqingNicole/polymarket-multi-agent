# polymarket-multi-agent

Real-time Polymarket arbitrage scanner with a multi-agent LLM analysis pipeline.

Built on top of [arti-challenge](https://github.com/caiyin-bit/arti-challenge) — extends its data connectors, anomaly detection, and agent pipeline into a standalone CLI scanner that continuously hunts for mispriced events.

---

## What it does

1. **Fetches** the top 200 most-active Polymarket markets via the Gamma REST API
2. **Scores** every market across four signal dimensions:
   - Cross-platform spread (Polymarket vs Kalshi price gap)
   - Probability drift (rapid 24h probability change)
   - Volume spike (unusual 24h volume surge)
   - Liquidity mispricing (thin book + large spread)
3. **Ranks** opportunities by composite score (0–100)
4. **Runs** the multi-agent LLM pipeline (Analyst → Bull/Bear Debate → Trader/Risk) on the top N events
5. **Outputs** a formatted console report and optionally saves JSON to `reports/`

---

## Architecture

```
src/
├── scanner.ts                  # CLI entry point
└── lib/
    ├── scanner/
    │   ├── index.ts            # ArbitrageScanner class + runScan()
    │   ├── scorer.ts           # Signal detection & composite scoring
    │   ├── builder.ts          # Raw Gamma API → AgentInput normalizer
    │   ├── formatter.ts        # Console output + JSON report writer
    │   └── types.ts            # ArbitrageOpportunity, ScanResult, ScannerConfig
    ├── agents/                 # From arti-challenge: pipeline, prompts, LLM client
    ├── connectors/             # From arti-challenge: Polymarket REST + WebSocket
    └── analysis/               # From arti-challenge: anomaly detection, screener
```

### Scoring formula

```
score = spread × 0.4 + drift × 0.3 + volume × 0.2 + liquidity × 0.1
```

Each sub-score is normalized 0–100:
- **spread**: 3c → 15pts, 10c → 50pts, 20c+ → 100pts
- **drift**: 4pt → 16pts, 15pt → 60pts, 25pt+ → 100pts
- **volume**: 50% surge → 12pts, 200% → 60pts, 400%+ → 100pts
- **liquidity**: thin book + spread → up to 10pts

### Multi-agent pipeline (from arti-challenge)

```
AgentInput → Analyst Agent → Bull/Bear Debate → Trader Agent → AgentVerdict
                                                     ↓
                                         BUY YES | BUY NO | ARBITRAGE | HOLD
```

Falls back to deterministic verdict if the LLM call fails.

---

## Quick start

```bash
# Install dependencies
npm install

# Copy and fill in your environment variables
cp .env.example .env

# Single scan (with LLM analysis on top 3)
npm run scan

# Continuous scan every 2 minutes
npm run scan:loop

# Fast scan without LLM (no API cost)
npm run scan:no-llm

# Custom options
npx tsx src/scanner.ts --loop --interval 60 --min-score 40 --top 10 --output reports/
```

---

## Environment variables

```env
# Required for LLM analysis
OPENROUTER_API_KEY=your_key_here

# Optional — defaults shown
POLYMARKET_GAMMA_URL=https://gamma-api.polymarket.com
POLYMARKET_WS_URL=wss://ws-subscriptions-clob.polymarket.com/ws/market
AGENT_ENGINE=llm          # or: deterministic (no LLM, free)
```

---

## CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--loop` | off | Run continuously |
| `--interval <sec>` | 120 | Seconds between scans in loop mode |
| `--no-llm` | off | Skip LLM analysis (faster, no API cost) |
| `--min-score <n>` | 30 | Minimum composite score to include |
| `--top <n>` | 20 | Max opportunities to show per scan |
| `--output <dir>` | off | Save JSON report to this directory |

---

## Output example

```
════════════════════════════════════════════════════════════════════════════════
 POLYMARKET ARBITRAGE SCANNER
 Scan time : 2026-06-30T07:00:00.000Z
 Markets   : 200 scanned → 12 opportunities found
════════════════════════════════════════════════════════════════════════════════

 #01  Will the Fed cut rates before September 2026?
────────────────────────────────────────────────────────────────────────────────
 Score: 72/100  │  Type: probability_drift  │  Source: poly
 Prob:  Poly 34.2%  │  Kalshi 34.2%  │  Spread: 0c
 Vol24h: $1.2M  │  Liquidity: $340K  │  Δprob: +12.5pts
 Signals:
   • Probability drift: ↑12.5pts in 24h (now 34.2%)
   • Volume spike: +180% in 24h ($1.2M)
 LLM Decision: BUY YES
   Strong Fed pivot signal driven by softer CPI print.
   Bull case outweighs near-term rate hold risk.
```

---

## Credits

Core data pipeline and multi-agent architecture from [arti-challenge](https://github.com/caiyin-bit/arti-challenge) by caiyin-bit. This repo adds the arbitrage scoring layer, CLI scanner, and batch analysis orchestration.
