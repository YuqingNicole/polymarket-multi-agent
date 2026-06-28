import 'dotenv/config'
import { buildSeedBundle } from '@/lib/seed/toDomain'
import { insertTicks, upsertMarkets, upsertPairs } from '@/lib/store'
import { recomputeSignals } from '@/lib/ingest/recompute'
import { prisma } from '@/lib/db'

// Loads the bundled demo dataset into Postgres and recomputes signals.
// Idempotent: clears ticks first so reseeding doesn't pile up history.
async function main() {
  const bundle = buildSeedBundle()
  await prisma.tick.deleteMany({})
  await upsertMarkets(bundle.markets)
  await insertTicks(bundle.ticks)
  await upsertPairs(bundle.pairs)
  const signals = await recomputeSignals()
  console.log(
    `seeded ${bundle.markets.length} markets · ${bundle.ticks.length} ticks · ${bundle.pairs.length} pairs · ${signals.length} signals`,
  )
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
