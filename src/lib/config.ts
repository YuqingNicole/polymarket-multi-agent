import { z } from 'zod'

// Centralized, validated configuration. Read once at import.
const schema = z.object({
  DATABASE_URL: z.string().default('postgresql://augur:augur@localhost:5544/augur?schema=public'),
  DATA_SOURCE: z.enum(['seed', 'live']).default('seed'),
  KALSHI_POLL_MS: z.coerce.number().int().positive().default(4000),

  POLYMARKET_GAMMA_URL: z.string().default('https://gamma-api.polymarket.com'),
  POLYMARKET_CLOB_URL: z.string().default('https://clob.polymarket.com'),
  POLYMARKET_WS_URL: z.string().default('wss://ws-subscriptions-clob.polymarket.com/ws/market'),
  KALSHI_API_URL: z.string().default('https://external-api.kalshi.com/trade-api/v2'),

  AGENT_ENGINE: z.enum(['deterministic', 'llm']).default('deterministic'),
  // DeepSeek official API (OpenAI-compatible)
  DEEPSEEK_API_KEY: z.string().default(''),
  DEEPSEEK_BASE_URL: z.string().default('https://api.deepseek.com'),
  DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  DEEPSEEK_MODEL_FALLBACK: z.string().default(''),
})

export const config = schema.parse(process.env)
export type Config = z.infer<typeof schema>
