import { z } from 'zod'
import { config } from '@/lib/config'

// Thin DeepSeek chat client (official API, OpenAI-compatible) with JSON-mode +
// zod validation and optional fallback model. Built so the agent pipeline can
// ask for a typed object and get retries/validation for free.

export class LlmError extends Error {}

interface ChatOpts {
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

async function rawChat(model: string, messages: ChatMessage[], opts: ChatOpts): Promise<string> {
  if (!config.DEEPSEEK_API_KEY) throw new LlmError('DEEPSEEK_API_KEY is not set')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 45000)
  try {
    const res = await fetch(`${config.DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: opts.maxTokens ?? 2000,
        temperature: opts.temperature ?? 0.4,
        response_format: { type: 'json_object' },
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new LlmError(`DeepSeek ${model} HTTP ${res.status}: ${body.slice(0, 300)}`)
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const content = json.choices?.[0]?.message?.content
    if (!content) throw new LlmError(`DeepSeek ${model} returned empty content`)
    return content
  } finally {
    clearTimeout(timer)
  }
}

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // tolerate ```json fences or prose around the object
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
    throw new LlmError('LLM response was not valid JSON')
  }
}

// Ask the LLM for a JSON object validated against `schema`. Tries the primary
// model, then the fallback model, before giving up.
export async function chatJSON<T>(
  schema: z.ZodSchema<T>,
  messages: ChatMessage[],
  opts: ChatOpts = {},
): Promise<T> {
  const models = [config.DEEPSEEK_MODEL, config.DEEPSEEK_MODEL_FALLBACK].filter(
    (m, i, a) => m && a.indexOf(m) === i,
  )
  let lastErr: unknown
  for (const model of models) {
    try {
      const content = await rawChat(model, messages, opts)
      return schema.parse(extractJson(content))
    } catch (err) {
      lastErr = err
    }
  }
  throw new LlmError(`all models failed: ${String(lastErr)}`)
}
