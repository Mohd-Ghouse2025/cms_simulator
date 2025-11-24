import type React from "react"
import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import Script from "next/script"
import { AppProviders } from "@/app/providers"

const themeInitScript = `(function(){try{var STORAGE_KEY='ocpp-theme';var theme=localStorage.getItem(STORAGE_KEY);if(theme!=='dark'&&theme!=='light'){theme=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}var apply=function(){var body=document.body;if(body){body.classList.toggle('theme-dark',theme==='dark');}document.documentElement.classList.toggle('dark',theme==='dark');document.documentElement.setAttribute('data-theme',theme);};if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',apply,{once:true});}else{apply();}}catch(e){}})();`
import "./globals.css"
import "@/styles/globals.css"
import "@/styles/ocpp/globals.css"
import "@/styles/ocpp/theme.css"
import "@/styles/ocpp/typography.css"

const _geist = Geist({ subsets: ["latin"] })
const _geistMono = Geist_Mono({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "EV Charger Simulator",
  description: "OCPP Simulator Control Panel",
  generator: "v0.app",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
      </head>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <AppProviders>
          {children}
          <Analytics />
        </AppProviders>
      </body>
    </html>
  )
}
