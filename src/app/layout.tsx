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
      <head>
        {/* Apply the persisted theme before first paint to avoid a dark flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('augur-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
