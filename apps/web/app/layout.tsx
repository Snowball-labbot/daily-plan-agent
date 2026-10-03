import type { Metadata, Viewport } from 'next'
import './web.css'
export const metadata: Metadata = { title: '每日计划 · Agnes', description: '复盘、进展与下一步安排', manifest: '/manifest.webmanifest', icons:{icon:'/icon.svg',apple:'/icon-180.png'}, appleWebApp: { capable: true, title: '每日计划', statusBarStyle: 'default' } }
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#ffffff' }
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="zh-CN"><body>{children}</body></html> }
