'use client'

import { useState } from 'react'
import { today, ymd } from '@/lib/date'

type Props = { value: string; onChange: (v: string) => void }

type Level = 'day' | 'month' | 'year'

const WEEK = ['一', '二', '三', '四', '五', '六', '日']
const MONTHS = ['1 月', '2 月', '3 月', '4 月', '5 月', '6 月', '7 月', '8 月', '9 月', '10 月', '11 月', '12 月']
const YEAR_PAGE = 12

export default function DatePicker({ value, onChange }: Props) {
  const [y0, m0] = value.split('-').map(Number)
  const [view, setView] = useState({ y: y0, m: m0 - 1 })
  const [level, setLevel] = useState<Level>('day')

  const t = today()
  const [ty, tm] = t.split('-').map(Number)

  /* ---------- 日视图 ---------- */
  const first = new Date(view.y, view.m, 1)
  const lead = (first.getDay() + 6) % 7 // 周一起头
  const days = new Date(view.y, view.m + 1, 0).getDate()
  const prevDays = new Date(view.y, view.m, 0).getDate()
  const tail = (7 - ((lead + days) % 7)) % 7

  const cells: { key: string; label: number; date: string; out: boolean }[] = []
  for (let i = lead - 1; i >= 0; i--) {
    const d = prevDays - i
    cells.push({ key: `p${d}`, label: d, date: ymd(view.m ? view.y : view.y - 1, (view.m + 11) % 12, d), out: true })
  }
  for (let d = 1; d <= days; d++) cells.push({ key: `c${d}`, label: d, date: ymd(view.y, view.m, d), out: false })
  for (let d = 1; d <= tail; d++) {
    cells.push({ key: `n${d}`, label: d, date: ymd(view.m === 11 ? view.y + 1 : view.y, (view.m + 1) % 12, d), out: true })
  }

  /* ---------- 年视图分页：以 1996 这种年份为例，一页 12 年 ---------- */
  const pageStart = Math.floor(view.y / YEAR_PAGE) * YEAR_PAGE
  const years = Array.from({ length: YEAR_PAGE }, (_, i) => pageStart + i)

  /** 上一页 / 下一页，按当前层级决定步长 */
  const page = (dir: 1 | -1) => {
    setView((v) => {
      if (level === 'day') {
        const m = v.m + dir
        if (m < 0) return { y: v.y - 1, m: 11 }
        if (m > 11) return { y: v.y + 1, m: 0 }
        return { y: v.y, m }
      }
      if (level === 'month') return { ...v, y: v.y + dir }
      return { ...v, y: v.y + dir * YEAR_PAGE }
    })
  }

  const pickDay = (date: string) => {
    onChange(date)
    const [yy, mm] = date.split('-').map(Number)
    setView({ y: yy, m: mm - 1 })
  }

  const jumpToday = () => {
    setLevel('day')
    pickDay(t)
  }

  const title =
    level === 'day'
      ? `${view.y} 年 ${view.m + 1} 月`
      : level === 'month'
        ? `${view.y} 年`
        : `${pageStart}\u2013${pageStart + YEAR_PAGE - 1}`

  // 点标题逐级上钻：日 → 月 → 年，到年为止
  const drillUp = () => setLevel((l) => (l === 'day' ? 'month' : l === 'month' ? 'year' : 'year'))

  return (
    <div className="dp" role="group" aria-label="抵达日期">
      <div className="dp-head">
        <button type="button" onClick={() => page(-1)} aria-label={level === 'day' ? '上个月' : level === 'month' ? '上一年' : '上 12 年'}>
          ‹
        </button>
        <button
          type="button"
          className="dp-title"
          onClick={drillUp}
          aria-label="切换到更大的时间粒度"
          title={level === 'day' ? '点这里选年月' : level === 'month' ? '点这里选年份' : ''}
        >
          {title}
          {level !== 'year' && <i aria-hidden="true">▾</i>}
        </button>
        <button type="button" onClick={() => page(1)} aria-label={level === 'day' ? '下个月' : level === 'month' ? '下一年' : '下 12 年'}>
          ›
        </button>
      </div>

      {level === 'day' && (
        <>
          <div className="dp-wk">
            {WEEK.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="dp-grid">
            {cells.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`${c.out ? 'out' : ''}${c.date === value ? ' on' : ''}${c.date === t ? ' today' : ''}`}
                onClick={() => pickDay(c.date)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </>
      )}

      {level === 'month' && (
        <div className="dp-grid cols3">
          {MONTHS.map((label, i) => (
            <button
              key={label}
              type="button"
              className={`wide${view.y === y0 && i === m0 - 1 ? ' on' : ''}${view.y === ty && i === tm - 1 ? ' today' : ''}`}
              onClick={() => {
                setView((v) => ({ ...v, m: i }))
                setLevel('day')
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {level === 'year' && (
        <div className="dp-grid cols3">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              className={`wide${y === y0 ? ' on' : ''}${y === ty ? ' today' : ''}`}
              onClick={() => {
                setView((v) => ({ ...v, y }))
                setLevel('month')
              }}
            >
              {y}
            </button>
          ))}
        </div>
      )}

      <div className="dp-foot">
        <span className="dp-sel mono">{value}</span>
        <button type="button" className="chip" onClick={jumpToday}>
          回到今天
        </button>
      </div>
    </div>
  )
}
