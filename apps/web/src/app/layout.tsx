import type { Metadata } from 'next'
import { Providers } from './providers'
import { NoZoom } from '@/components/NoZoom'
import './globals.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Valor · One human. One warrior.',
  description: 'Valor · One human. One warrior. Fight, earn real G$, own everything. Built on GoodDollar + Celo.',
  icons: {
    icon: [
      { url: '/valor-icon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/valor-icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/valor-icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/valor-icon.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Valor',
  },
  other: {
    'mobile-web-app-capable': 'yes',
    'talentapp:project_verification':
      'e533deb2e7132258b7993c84b2458f36a8fc8ab5f6d32a6aa25347ff61d284cc4ac8c09a6d18ae09bca77bac5a74a0532044156c3bd622df5d9780f3d5889125',
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,       // lock zoom — VALOR is a fullscreen game, not a document
  userScalable: false,   // a stray double-tap / pinch mid-fight must not zoom the HUD
  viewportFit: 'cover',
  themeColor: '#04030c',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <NoZoom />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
