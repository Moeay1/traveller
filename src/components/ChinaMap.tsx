'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { MapData, ringToPath, shortName, unitToPath } from '@/lib/mapdata'
import { Inset } from '@/lib/regions'

type Props = {
  data: MapData
  /** 当前应当点亮的城市 */
  lit: Set<number>
  /** 每座城的颜色（该城所有到访涉及的人）；多色时对角切分 */
  cityColors: Map<number, string[]>
  /** 该国地图的初始视窗 */
  baseView: { x: number; y: number; w: number; h: number }
  /** 离主体太远、单独画成小图的部分（中国是南海诸岛，日本是冲绳） */
  inset: Inset
  selected: number | null
  /** 回放中：屏蔽选中交互 */
  frozen?: boolean
  /** 需要播放涟漪的事件；key 变化即重放动画 */
  ping?: { adcode: number; key: string; repeat: boolean; colors: string[] } | null
  onPick: (adcode: number) => void
  onPickDouble: (adcode: number) => void
}

/** 交给外部工具栏调用的操作 */
export type MapHandle = {
  zoomIn: () => void
  zoomOut: () => void
  reset: () => void
  /** 把某座城市推到视野中心并放大 */
  focus: (adcode: number) => void
}

const ChinaMap = forwardRef<MapHandle, Props>(function ChinaMap(
  { data, lit, cityColors, baseView, inset, selected, frozen, ping, onPick, onPickDouble },
  ref,
) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState({ ...baseView })
  const [tip, setTip] = useState<{ x: number; y: number; adcode: number } | null>(null)

  const byCode = useMemo(() => new Map(data.u.map((u) => [u.a, u])), [data])
  /**
   * 主图不画进了小图的那些单元。主视窗的裁剪边界会从它们中间切过，
   * 不排除的话会在主图角落露出半截，跟小图重复。
   */
  const paths = useMemo(
    () => data.u.filter((u) => !inset.units.includes(u.n)).map((u) => ({ u, d: unitToPath(u) })),
    [data, inset],
  )
  const provPaths = useMemo(() => data.pv.map(ringToPath), [data])
  const jdPaths = useMemo(
    () => data.jd.map((l) => ringToPath(l).replace(/Z$/, '')),
    [data],
  )
  /** 画进小图的那些单元 */
  const insetUnits = useMemo(
    () => data.u.filter((u) => inset.units.includes(u.n)),
    [data, inset],
  )

  /* ---------- 多人城市的对角双色/多色填充 ----------
     用硬断点的线性渐变实现：同一颜色连着两个 stop，色与色之间不过渡，
     所以是干净的斜向色带而不是混色。渐变方向沿包围盒对角线，形状再不规则也能自适应。 */
  const fillKey = (colors: string[]) => 'f' + colors.map((c) => c.slice(1)).join('')

  const combos = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const cs of cityColors.values()) {
      if (cs.length > 1) m.set(fillKey(cs), cs)
    }
    return [...m.entries()]
  }, [cityColors])

  const fillOf = (adcode: number): string | undefined => {
    const cs = cityColors.get(adcode)
    if (!cs?.length) return undefined
    return cs.length === 1 ? cs[0] : `url(#${fillKey(cs)})`
  }

  /* ---------- 缩放 ---------- */
  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setView((v) => {
      const w = Math.min(baseView.w * 1.4, Math.max(baseView.w * 0.06, v.w * factor))
      const k = w / v.w
      return { x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k, w, h: v.h * k }
    })
  }, [])

  const toMap = useCallback(
    (clientX: number, clientY: number) => {
      const r = svgRef.current!.getBoundingClientRect()
      return [view.x + ((clientX - r.left) / r.width) * view.w, view.y + ((clientY - r.top) / r.height) * view.h]
    },
    [view],
  )

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    // React 的 onWheel 是被动监听，阻止不了页面滚动，这里手动绑非被动的
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const [x, y] = toMap(e.clientX, e.clientY)
      zoomAt(e.deltaY > 0 ? 1.16 : 0.86, x, y)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [toMap, zoomAt])

  /* ---------- 手势：单指拖拽平移，双指捏合缩放 ----------
     注意：不能在 pointerdown 就 setPointerCapture，那会把随后的 click
     事件目标改写成 <svg>，城市就点不中了。位移超过阈值确认是拖拽后再抓。 */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; pid: number; cap: boolean } | null>(null)
  /** 双指起始状态：两指间距、中点、以及中点当时对应的地图坐标 */
  const pinch = useRef<{ dist: number; mid: [number, number]; anchor: [number, number]; w: number; h: number } | null>(null)
  const moved = useRef(0)
  const downCity = useRef<number | null>(null)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const DRAG_MIN = 4

  const hitCity = (e: React.MouseEvent): number | null => {
    const el = (e.target as Element).closest('[data-adcode]')
    const a = el?.getAttribute('data-adcode')
    return a ? Number(a) : downCity.current
  }

  const twoFingers = () => {
    const [a, b] = [...pointers.current.values()]
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: [(a.x + b.x) / 2, (a.y + b.y) / 2] as [number, number],
    }
  }

  const startPinch = () => {
    const { dist, mid } = twoFingers()
    pinch.current = { dist, mid, anchor: toMap(mid[0], mid[1]) as [number, number], w: view.w, h: view.h }
    drag.current = null
  }

  const startDrag = (pid: number, x: number, y: number) => {
    drag.current = { x, y, vx: view.x, vy: view.y, pid, cap: false }
    moved.current = 0
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const el = (e.target as Element).closest('[data-adcode]')
    downCity.current = el ? Number(el.getAttribute('data-adcode')) : null

    if (pointers.current.size === 2) startPinch()
    else if (pointers.current.size === 1) startDrag(e.pointerId, e.clientX, e.clientY)
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }

    // 双指：以两指中点为锚点同时缩放和平移
    if (pointers.current.size >= 2 && pinch.current) {
      const p = pinch.current
      const { dist, mid } = twoFingers()
      if (dist > 0) {
        const raw = (p.w * p.dist) / dist
        const w = Math.min(baseView.w * 1.4, Math.max(baseView.w * 0.06, raw))
        const h = (w * p.h) / p.w
        const r = svgRef.current!.getBoundingClientRect()
        setView({
          x: p.anchor[0] - ((mid[0] - r.left) / r.width) * w,
          y: p.anchor[1] - ((mid[1] - r.top) / r.height) * h,
          w,
          h,
        })
        moved.current = DRAG_MIN + 1 // 捏合过就不再当成点击
        setTip(null)
      }
      return
    }

    const d = drag.current
    if (d) {
      moved.current = Math.max(moved.current, Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y))
      if (moved.current > DRAG_MIN) {
        if (!d.cap) {
          d.cap = true
          try {
            svgRef.current?.setPointerCapture(d.pid)
          } catch {}
          setTip(null)
        }
        const r = svgRef.current!.getBoundingClientRect()
        setView({
          x: d.vx - ((e.clientX - d.x) / r.width) * view.w,
          y: d.vy - ((e.clientY - d.y) / r.height) * view.h,
          w: view.w,
          h: view.h,
        })
        return
      }
    }
    const el = (e.target as Element).closest('[data-adcode]')
    if (el) {
      const r = svgRef.current!.parentElement!.getBoundingClientRect()
      setTip({ x: e.clientX - r.left, y: e.clientY - r.top, adcode: Number(el.getAttribute('data-adcode')) })
    } else setTip(null)
  }

  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId)
    const d = drag.current
    if (d?.cap) {
      try {
        svgRef.current?.releasePointerCapture(d.pid)
      } catch {}
    }
    drag.current = null

    if (pointers.current.size < 2) pinch.current = null
    // 松开一根手指还剩一根，接着当拖拽用，不然地图会卡住
    if (pointers.current.size === 1) {
      const [pid, pos] = [...pointers.current.entries()][0]
      startDrag(pid, pos.x, pos.y)
      moved.current = DRAG_MIN + 1 // 这一段是手势的延续，不该触发点击
    }
  }

  const handleClick = (e: React.MouseEvent) => {
    if (moved.current > DRAG_MIN || frozen) return
    const a = hitCity(e)
    if (a == null) return
    if (clickTimer.current) clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => onPick(a), 200) // 等一手，看看是不是双击
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (frozen) return
    const a = hitCity(e)
    if (a == null) return
    e.preventDefault()
    if (clickTimer.current) clearTimeout(clickTimer.current)
    onPickDouble(a)
  }

  useEffect(() => () => { if (clickTimer.current) clearTimeout(clickTimer.current) }, [])

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomAt(0.75, view.x + view.w / 2, view.y + view.h / 2),
      zoomOut: () => zoomAt(1.33, view.x + view.w / 2, view.y + view.h / 2),
      reset: () => setView({ ...baseView }),
      focus: (adcode: number) => {
        const u = byCode.get(adcode)
        if (!u) return
        const w = 260
        const h = (w * baseView.h) / baseView.w
        setView({ x: u.c[0] - w / 2, y: u.c[1] - h / 2, w, h })
      },
    }),
    [byCode, view, zoomAt, baseView],
  )

  const tipUnit = tip ? byCode.get(tip.adcode) : null

  return (
    <>
      <svg
        ref={svgRef}
        id="map"
        aria-label="中国地级市地图"
        className={drag.current?.cap ? 'drag' : undefined}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={(e) => {
          endDrag(e)
          setTip(null)
        }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <defs>
          <linearGradient id="litgrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#EDA23C" />
            <stop offset="1" stopColor="#C97514" />
          </linearGradient>
          <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="1.4" stdDeviation="2.2" floodColor="#2A2118" floodOpacity=".26" />
          </filter>

          {combos.map(([key, colors]) => (
            <linearGradient key={key} id={key} x1="0" y1="0" x2="1" y2="1">
              {colors.flatMap((c, i) => [
                <stop key={`${i}a`} offset={i / colors.length} stopColor={c} />,
                <stop key={`${i}b`} offset={(i + 1) / colors.length} stopColor={c} />,
              ])}
            </linearGradient>
          ))}
        </defs>

        {/* 九段线只画在小图里，主图上会跟主体离得很远 */}
        <g id="jdLayer" />

        {/* 点亮城市的投影托底层 */}
        <g id="litLayer">
          {paths
            .filter(({ u }) => lit.has(u.a))
            .map(({ u, d }) => (
              <path key={u.a} d={d} style={{ fill: fillOf(u.a) ?? 'var(--lit)' }} filter="url(#soft)" />
            ))}
        </g>

        <g id="baseLayer">
          {paths.map(({ u, d }) => (
            <path
              key={u.a}
              d={d}
              data-adcode={u.a}
              style={lit.has(u.a) ? { fill: fillOf(u.a) } : undefined}
              className={`city${lit.has(u.a) ? ' lit' : ''}${selected === u.a ? ' sel' : ''}`}
            />
          ))}
        </g>

        <g id="pvLayer">
          {provPaths.map((d, i) => (
            <path key={i} d={d} className="prov" />
          ))}
        </g>

        <g id="lblLayer">
          {paths
            .filter(({ u }) => lit.has(u.a))
            .map(({ u }) => (
              <text key={u.a} x={u.c[0]} y={u.c[1] - 6} className="lbl">
                {shortName(u.n)}
              </text>
            ))}
        </g>

        <g id="fxLayer">
          {ping && byCode.get(ping.adcode) && (
            <g key={ping.key}>
              <circle
                cx={byCode.get(ping.adcode)!.c[0]}
                cy={byCode.get(ping.adcode)!.c[1]}
                r={9}
                className="ping"
                stroke={ping.colors[0]}
              />
              {/* 重复到访：补一圈延迟出发的涟漪，跟第一次去区分开 */}
              {ping.repeat && (
                <circle
                  cx={byCode.get(ping.adcode)!.c[0]}
                  cy={byCode.get(ping.adcode)!.c[1]}
                  r={9}
                  className="ping delay"
                  stroke={ping.colors[ping.colors.length - 1]}
                />
              )}
            </g>
          )}
        </g>
      </svg>

      <div id="inset" style={{ width: inset.size.w, height: inset.size.h }}>
        <svg viewBox={inset.viewBox} aria-hidden="true">
          {inset.nineDash && jdPaths.map((d, i) => <path key={i} d={d} className="jd" />)}
          {insetUnits.map((u) => (
            <path
              key={u.a}
              d={unitToPath(u)}
              data-adcode={u.a}
              style={lit.has(u.a) ? { fill: fillOf(u.a) } : undefined}
              className={`city${lit.has(u.a) ? ' lit' : ''}${selected === u.a ? ' sel' : ''}`}
            />
          ))}
        </svg>
        <span>{inset.label}</span>
      </div>

      {tipUnit && (
        <div id="tip" className="on" style={{ left: tip!.x, top: tip!.y }}>
          <b>{tipUnit.n}</b>
          <em>{tipUnit.p}</em>
          {lit.has(tipUnit.a) && <div className="d">已点亮</div>}
        </div>
      )}
    </>
  )
})

export default ChinaMap
