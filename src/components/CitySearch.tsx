'use client'

import { useMemo, useState } from 'react'
import { MapUnit } from '@/lib/mapdata'

type Props = {
  units: MapUnit[]
  onPick: (adcode: number) => void
}

export default function CitySearch({ units, onPick }: Props) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)

  const hits = useMemo(() => {
    const v = q.trim()
    if (!v) return []
    return units.filter((u) => u.n.includes(v) || u.p.includes(v)).slice(0, 12)
  }, [q, units])

  return (
    <div className="search">
      <input
        type="text"
        value={q}
        placeholder="搜索城市…"
        autoComplete="off"
        aria-label="搜索城市"
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        // 延迟关闭，否则点击建议项时输入框先失焦，点击落空
        onBlur={() => setTimeout(() => setOpen(false), 160)}
      />
      {open && q.trim() && (
        <div className="sug on">
          {hits.length ? (
            hits.map((u) => (
              <button
                key={u.a}
                type="button"
                onClick={() => {
                  onPick(u.a)
                  setQ('')
                  setOpen(false)
                }}
              >
                {u.n}
                <small>{u.p}</small>
              </button>
            ))
          ) : (
            <button type="button" disabled style={{ color: 'var(--tx-dim)' }}>
              没有找到
            </button>
          )}
        </div>
      )}
    </div>
  )
}
