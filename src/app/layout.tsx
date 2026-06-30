import type { Metadata } from 'next'
import './globals.css'
import './overrides.css'

export const metadata: Metadata = {
  title: 'Augur Terminal',
  description: 'Prediction-market data + analysis terminal · Polymarket × Kalshi',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  )
}
