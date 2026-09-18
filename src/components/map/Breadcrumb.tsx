'use client'

import type { View } from '@/lib/mapview'

export type Crumb = { label: string; view: View | null }

/**
 * 层级面包屑「中国 › 云南 › 昆明市」，替代一个孤立的返回按钮 ——
 * 它同时回答「我在哪一层」和「怎么回去」。最后一级是当前位置，不可点。
 *
 * 用事件代理而不是给每个按钮挂 onclick：这个组件会随视窗每帧重渲染，
 * 挂在按钮上的处理器会在重建的空档里把点击丢掉（原型里踩过）。
 */
export default function Breadcrumb({
  crumbs,
  onGo,
}: {
  crumbs: readonly Crumb[]
  onGo: (view: View) => void
}) {
  if (crumbs.length <= 1) return null
  return (
    <nav
      id="crumb"
      aria-label="地图层级"
      onClick={(e) => {
        const btn = (e.target as Element).closest('button')
        const i = btn?.getAttribute('data-i')
        if (i === null || i === undefined) return
        const view = crumbs[Number(i)]?.view
        if (view) onGo(view)
      }}
    >
      {crumbs.map((c, i) => (
        <span key={`${c.label}-${i}`}>
          {i > 0 && <i aria-hidden="true">›</i>}
          <button type="button" data-i={i} disabled={!c.view} aria-current={c.view ? undefined : 'page'}>
            {c.label}
          </button>
        </span>
      ))}
    </nav>
  )
}
