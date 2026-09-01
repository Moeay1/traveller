import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '旅痕 · 中国足迹图',
  description: '点亮走过的每一座地级市，记录日期与备注。',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 手机浏览器地址栏跟着页面底色走
  themeColor: '#F7F8FA',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning 只作用于 <html> 这一层的属性对比。
    // 「沉浸式翻译」这类扩展会在 React 接管前往 html 上塞 data-* 属性
    // （如 data-immersive-translate-page-theme），导致服务端渲染结果和客户端 DOM 不一致而报错。
    // 加这个只是让 React 别去比 <html> 自身的属性，子树的 hydration 检查照常进行，
    // 真正的不匹配问题不会被掩盖。
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@500;700&family=Noto+Sans+SC:wght@300;400;500&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
