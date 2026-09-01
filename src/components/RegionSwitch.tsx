'use client'

import { useEffect, useRef, useState } from 'react'
import { REGIONS, RegionCode, regionOf } from '@/lib/regions'

type Props = {
  value: RegionCode
  /** 各国的记录数，显示在名字后面 */
  counts: Record<string, number>
  onChange: (code: RegionCode) => void
}

export default function RegionSwitch({ value, counts, onChange }: Props) {
  const [open, setOpen] = useState(false)
  /** 键盘浏览时高亮的项，跟实际选中分开 */
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const current = regionOf(value)

  // 点外面关掉
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const openList = () => {
    setActive(REGIONS.findIndex((r) => r.code === value))
    setOpen(true)
  }

  const pick = (code: RegionCode) => {
    setOpen(false)
    btnRef.current?.focus()
    if (code !== value) onChange(code)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openList()
      }
      return
    }
    if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % REGIONS.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + REGIONS.length) % REGIONS.length) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(REGIONS[active].code) }
  }

  return (
    <div className="rsw" ref={boxRef} onKeyDown={onKey}>
      <button
        ref={btnRef}
        type="button"
        className={`rsw-btn${open ? ' open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openList())}
      >
        <span className="rsw-name">{current.name}</span>
        {counts[current.code] > 0 && <em>{counts[current.code]}</em>}
        <i aria-hidden="true" />
      </button>

      {open && (
        <div className="rsw-list" role="listbox" aria-label="切换国家">
          {REGIONS.map((r, i) => (
            <button
              key={r.code}
              type="button"
              role="option"
              aria-selected={r.code === value}
              className={`${r.code === value ? 'on' : ''}${i === active ? ' active' : ''}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(r.code)}
            >
              <span className="rsw-tick" aria-hidden="true">{r.code === value ? '✓' : ''}</span>
              {r.name}
              {counts[r.code] > 0 && <em>{counts[r.code]}</em>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
