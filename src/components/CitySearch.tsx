'use client'

import { useMemo, useState } from 'react'
import { MapUnit } from '@/lib/mapdata'

/** 区县名录里的一条（无几何），由 MapApp 在空闲时加载 */
export type CountyName = { a: number; n: string; p: number }

export type SearchHit =
  | { level: 'city'; adcode: number; name: string; sub: string }
  | { level: 'county'; adcode: number; name: string; sub: string; parent: number }

type Props = {
  units: MapUnit[]
  /** 全量区县名录；没加载好就是空数组，退化成只搜市 */
  counties: readonly CountyName[]
  onPick: (hit: SearchHit) => void
}

export default function CitySearch({ units, counties, onPick }: Props) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)

  const cityByCode = useMemo(() => new Map(units.map((u) => [u.a, u])), [units])

  const hits = useMemo((): SearchHit[] => {
    const v = q.trim()
    if (!v) return []
    const cities: SearchHit[] = units
      .filter((u) => u.n.includes(v) || u.p.includes(v))
      .map((u) => ({ level: 'city' as const, adcode: u.a, name: u.n, sub: u.p }))

    const ctys: SearchHit[] = counties
      .filter((c) => c.n.includes(v))
      .map((c) => {
        const city = cityByCode.get(c.p)
        return {
          level: 'county' as const,
          adcode: c.a,
          name: c.n,
          // 区县必须带父级市消歧 —— 全国重名的「城关区」「新华区」一大把，
          // 只显示区县名等于没法选
          sub: city ? `${city.n} · ${city.p}` : '',
          parent: c.p,
        }
      })
      .filter((h) => h.sub !== '')

    // 市排在前面：搜「昆明」先要昆明市，不是某个含「昆明」的区
    return [...cities, ...ctys].slice(0, 14)
  }, [q, units, counties, cityByCode])

  return (
    <div className="search">
      <input
        type="text"
        value={q}
        placeholder={counties.length ? '搜索城市 / 区县…' : '搜索城市…'}
        autoComplete="off"
        aria-label="搜索城市或区县"
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
            hits.map((h) => (
              <button
                key={`${h.level}-${h.adcode}`}
                type="button"
                onClick={() => {
                  onPick(h)
                  setQ('')
                  setOpen(false)
                }}
              >
                {h.name}
                {h.level === 'county' && <i className="sug-lvl">区县</i>}
                <small>{h.sub}</small>
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
