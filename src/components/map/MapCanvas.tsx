'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { MapData, shortName, unitToPath } from '@/lib/mapdata'
import { DrillLevel, Inset } from '@/lib/regions'
import {
  bboxOfRings,
  drillBox,
  fitBox,
  intersects,
  labelScale,
  progress,
  zoomAt,
  type BBox,
  type View,
} from '@/lib/mapview'
import { ShardStore, type LoadedShard } from '@/lib/countyshards'
import {
  CityFillLayers,
  CityLabelLayer,
  CityLineLayer,
  InsetMap,
  ProvinceLayer,
  type CityPaths,
} from './CityLayer'
import CountyLayer, { type CountySel } from './CountyLayer'
import Breadcrumb, { type Crumb } from './Breadcrumb'

type Props = {
  data: MapData
  /** 该国地图的初始视窗 */
  baseView: View
  /** 离主体太远、单独画成小图的部分 */
  inset: Inset
  /** 下钻层配置；null = 这个国家没有下一层 */
  drill: DrillLevel | null
  /** 当前应当点亮的市（含区县记录折叠上来的） */
  lit: Set<number>
  /** 每座城的颜色 */
  cityColors: Map<number, string[]>
  /** 区县 adcode → 颜色 */
  countyColors: Map<number, string[]>
  /** 有市级记录但名下没有区县记录的市 → 它的区县画斜纹 */
  inheritCities: ReadonlySet<number>
  selected: number | null
  countySel: CountySel
  /** 回放中：屏蔽选中交互 */
  frozen?: boolean
  ping?: {
    adcode: number
    countyAdcode: number | null
    key: string
    repeat: boolean
    colors: string[]
  } | null
  onPick: (adcode: number) => void
  /** 双击 = 直接记录当前层级的这个单元。市层给市码，区县层给区县 */
  onPickDouble: (hit: { level: 'city'; adcode: number } | { level: 'county'; adcode: number; parent: number; name: string }) => void
  onPickCounty: (sel: {
    adcode: number
    parent: number
    name: string
    /** 该市一共有几个区县，抽屉里「本市区县进度 x/y」的分母 */
    siblingCount: number
  }) => void
}

export type MapHandle = {
  zoomIn: () => void
  zoomOut: () => void
  reset: () => void
  focus: (adcode: number) => void
  /** 飞进某个市的区县层 */
  drillInto: (adcode: number) => void
  /**
   * 预取某个市的分片。实测一片 12KB 里网络往返占 497ms、解析加建 path 只有 0.5ms，
   * 所以「下钻慢」完全是一次冷请求的等待 —— 提前取掉它，下钻就是瞬间的。
   */
  prefetch: (adcode: number) => void
}

const DRAG_MIN = 4
/** 涟漪基准半径（屏幕 px）。乘 k 转成用户坐标，放大后不跟着涨；
    动画本身是 CSS 的 transform:scale，跟这个值无关 */
const PING_R = 10

/** 命中的是哪一层。用 kind 做判别标签，不要靠 `'county' in hit` */
type Hit =
  | { kind: 'county'; adcode: number; parent: number }
  | { kind: 'city'; adcode: number }

const MapCanvas = forwardRef<MapHandle, Props>(function MapCanvas(
  {
    data,
    baseView,
    inset,
    drill,
    lit,
    cityColors,
    countyColors,
    inheritCities,
    selected,
    countySel,
    frozen,
    ping,
    onPick,
    onPickDouble,
    onPickCounty,
  },
  ref,
) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<View>({ ...baseView })
  const [tip, setTip] = useState<{ x: number; y: number; text: React.ReactNode } | null>(null)
  /** 分片到货后 +1，用来触发重渲染（ShardStore 本身不是 React state） */
  const [shardTick, setShardTick] = useState(0)

  const aspect = baseView.w / baseView.h
  const band = drill?.band
  const t = progress(view.w, band)
  const k = labelScale(view.w, svgRef.current?.clientWidth ?? 0)

  const byCode = useMemo(() => new Map(data.u.map((u) => [u.a, u])), [data])

  /**
   * 主图不画进了小图的那些单元。主视窗的裁剪边界会从它们中间切过，
   * 不排除的话会在主图角落露出半截，跟小图重复。
   */
  const paths: CityPaths = useMemo(
    () => data.u.filter((u) => !inset.units.includes(u.n)).map((u) => ({ u, d: unitToPath(u) })),
    [data, inset],
  )

  const cityBBox = useMemo(() => {
    const m = new Map<number, BBox>()
    for (const u of data.u) m.set(u.a, bboxOfRings(u.g))
    return m
  }, [data])

  /** 省包围盒，面包屑里点省名要用 */
  const provBBox = useMemo(() => {
    const m = new Map<string, BBox>()
    for (const u of data.u) {
      const b = cityBBox.get(u.a)!
      const g = m.get(u.p)
      if (!g) m.set(u.p, { ...b })
      else {
        g.x0 = Math.min(g.x0, b.x0); g.y0 = Math.min(g.y0, b.y0)
        g.x1 = Math.max(g.x1, b.x1); g.y1 = Math.max(g.y1, b.y1)
      }
    }
    return m
  }, [data, cityBBox])

  /* ---------- 分片仓库 ---------- */
  const store = useMemo(
    () => (drill ? new ShardStore(drill.dir, drill.index) : null),
    [drill],
  )

  /** 下钻到的市（供面包屑和市界加重用）；回到市层时清掉 */
  const [drilled, setDrilled] = useState<number | null>(null)

  /** 视窗内的市 —— 区县层只渲染这些 */
  const visibleCities = useMemo(() => {
    if (t <= 0) return []
    const pad = view.w * 0.15
    const out: number[] = []
    for (const u of data.u) {
      const b = cityBBox.get(u.a)
      if (b && intersects(b, view, pad)) out.push(u.a)
      if (out.length >= 40) break
    }
    return out
  }, [t, view, data, cityBBox])

  // 进带就把可见市的分片取回来。取不到的市保持市级样态，不报错。
  useEffect(() => {
    if (!store || !visibleCities.length) return
    let alive = true
    store.loadIndex().then(() => {
      if (!alive) return
      store.loadMany(visibleCities).then(() => alive && setShardTick((n) => n + 1))
    })
    return () => {
      alive = false
    }
  }, [store, visibleCities])

  const visibleShards = useMemo(() => {
    if (!store || t <= 0) return [] as LoadedShard[]
    const out: LoadedShard[] = []
    for (const a of visibleCities) {
      const s = store.get(a)
      if (s) out.push(s)
    }
    return out
    // shardTick 是「分片到货」的信号，必须进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, t, visibleCities, shardTick])

  const loadingShards = store && t > 0 ? store.pending > 0 : false

  /**
   * 下钻到位后，空闲时预取锚点最近的几个市。
   * 在区县层横着拖，下一个市的分片多半已经在手里了。
   */
  useEffect(() => {
    if (!store || t < 1 || drilled === null) return
    const self = byCode.get(drilled)
    if (!self) return
    const near = data.u
      .filter((u) => u.a !== drilled)
      .map((u) => ({ a: u.a, d: (u.c[0] - self.c[0]) ** 2 + (u.c[1] - self.c[1]) ** 2 }))
      .sort((x, y) => x.d - y.d)
      .slice(0, 8)
      .map((x) => x.a)
    let cancelled = false
    const run = () => {
      if (cancelled) return
      store.loadMany(near, 3).then(() => !cancelled && setShardTick((n) => n + 1))
    }
    const idle = (window as unknown as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
    }).requestIdleCallback
    const id = idle ? idle(run, { timeout: 2500 }) : window.setTimeout(run, 800)
    return () => {
      cancelled = true
      if (!idle) clearTimeout(id)
    }
  }, [store, t, drilled, data, byCode])

  /* ---------- 多人城市的对角双色/多色填充 ----------
     用硬断点的线性渐变实现：同一颜色连着两个 stop，色与色之间不过渡，
     所以是干净的斜向色带而不是混色。 */
  const fillKey = (colors: string[]) => 'f' + colors.map((c) => c.slice(1)).join('')

  const combos = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const cs of cityColors.values()) if (cs.length > 1) m.set(fillKey(cs), cs)
    for (const cs of countyColors.values()) if (cs.length > 1) m.set(fillKey(cs), cs)
    return [...m.entries()]
  }, [cityColors, countyColors])

  const fillFor = useCallback((cs: string[]) => (cs.length === 1 ? cs[0] : `url(#${fillKey(cs)})`), [])

  const fillOfCity = useCallback(
    (adcode: number) => {
      const cs = cityColors.get(adcode)
      return cs?.length ? fillFor(cs) : undefined
    },
    [cityColors, fillFor],
  )

  /* ---------- 缩放 ---------- */
  const doZoom = useCallback(
    (factor: number, cx: number, cy: number) => {
      setView((v) => {
        const next = zoomAt(v, factor, cx, cy, baseView.w)
        if (progress(next.w, band) === 0) setDrilled(null)
        return next
      })
    },
    [baseView.w, band],
  )

  const toMap = useCallback(
    (clientX: number, clientY: number) => {
      const r = svgRef.current!.getBoundingClientRect()
      return [
        view.x + ((clientX - r.left) / r.width) * view.w,
        view.y + ((clientY - r.top) / r.height) * view.h,
      ]
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
      doZoom(e.deltaY > 0 ? 1.16 : 0.86, x, y)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [toMap, doZoom])

  /* ---------- 飞行动画 ---------- */
  const anim = useRef<number | null>(null)
  const flyTo = useCallback((target: View, ms = 420) => {
    if (anim.current) cancelAnimationFrame(anim.current)
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setView(target)
      return
    }
    let from: View | null = null
    const t0 = performance.now()
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms)
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
      setView((cur) => {
        from ??= cur
        return {
          x: from.x + (target.x - from.x) * e,
          y: from.y + (target.y - from.y) * e,
          w: from.w + (target.w - from.w) * e,
          h: from.h + (target.h - from.h) * e,
        }
      })
      anim.current = p < 1 ? requestAnimationFrame(step) : null
    }
    anim.current = requestAnimationFrame(step)
  }, [])

  useEffect(() => () => { if (anim.current) cancelAnimationFrame(anim.current) }, [])

  /* ---------- 手势：单指拖拽平移，双指捏合缩放 ----------
     注意：不能在 pointerdown 就 setPointerCapture，那会把随后的 click
     事件目标改写成 <svg>，城市就点不中了。位移超过阈值确认是拖拽后再抓。 */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; pid: number; cap: boolean } | null>(null)
  const pinch = useRef<{ dist: number; anchor: [number, number]; w: number; h: number } | null>(null)
  const moved = useRef(0)
  const downHit = useRef<Hit | null>(null)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const twoFingers = () => {
    const [a, b] = [...pointers.current.values()]
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: [(a.x + b.x) / 2, (a.y + b.y) / 2] as [number, number],
    }
  }

  const hitOf = (target: Element): Hit | null => {
    const cty = target.closest('[data-county]')
    if (cty) {
      return {
        kind: 'county',
        adcode: Number(cty.getAttribute('data-county')),
        parent: Number(cty.getAttribute('data-parent')),
      }
    }
    const city = target.closest('[data-adcode]')
    if (city) return { kind: 'city', adcode: Number(city.getAttribute('data-adcode')) }
    return null
  }

  const startDrag = (pid: number, x: number, y: number) => {
    drag.current = { x, y, vx: view.x, vy: view.y, pid, cap: false }
    moved.current = 0
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    downHit.current = hitOf(e.target as Element)
    if (pointers.current.size === 2) {
      const { dist, mid } = twoFingers()
      pinch.current = { dist, anchor: toMap(mid[0], mid[1]) as [number, number], w: view.w, h: view.h }
      drag.current = null
    } else if (pointers.current.size === 1) {
      startDrag(e.pointerId, e.clientX, e.clientY)
    }
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
        const w = Math.min(baseView.w * 1.4, Math.max(baseView.w * 0.05, raw))
        const h = (w * p.h) / p.w
        const r = svgRef.current!.getBoundingClientRect()
        setView({
          x: p.anchor[0] - ((mid[0] - r.left) / r.width) * w,
          y: p.anchor[1] - ((mid[1] - r.top) / r.height) * h,
          w,
          h,
        })
        moved.current = DRAG_MIN + 1
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
          try { svgRef.current?.setPointerCapture(d.pid) } catch {}
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
    showTip(e.clientX, e.clientY, e.target as Element)
  }

  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId)
    const d = drag.current
    if (d?.cap) {
      try { svgRef.current?.releasePointerCapture(d.pid) } catch {}
    }
    drag.current = null
    if (pointers.current.size < 2) pinch.current = null
    // 松开一根手指还剩一根，接着当拖拽用，不然地图会卡住
    if (pointers.current.size === 1) {
      const [pid, pos] = [...pointers.current.entries()][0]
      startDrag(pid, pos.x, pos.y)
      moved.current = DRAG_MIN + 1
    }
  }

  /* ---------- 悬浮提示 ---------- */
  const lastPtr = useRef<{ x: number; y: number } | null>(null)

  const tipFor = useCallback(
    (hit: Hit): React.ReactNode | null => {
      if (hit.kind === 'county') {
        const shard = store?.get(hit.parent)
        const u = shard?.units.find((x) => x.a === hit.adcode)
        const city = byCode.get(hit.parent)
        if (!u) return null
        const hasOwn = (countyColors.get(u.a)?.length ?? 0) > 0
        return (
          <>
            <b>{u.n}</b>
            <em>{city ? shortName(city.n) : ''}</em>
            {hasOwn ? (
              <div className="d">已点亮</div>
            ) : inheritCities.has(hit.parent) ? (
              <div className="d">市级记录覆盖 · 区县待补</div>
            ) : null}
          </>
        )
      }
      const u = byCode.get(hit.adcode)
      if (!u) return null
      return (
        <>
          <b>{u.n}</b>
          <em>{u.p}</em>
          {lit.has(u.a) && <div className="d">已点亮</div>}
        </>
      )
    },
    [store, byCode, countyColors, inheritCities, lit],
  )

  const showTip = useCallback(
    (clientX: number, clientY: number, target: Element) => {
      lastPtr.current = { x: clientX, y: clientY }
      const hit = hitOf(target)
      if (!hit) {
        setTip(null)
        return
      }
      const text = tipFor(hit)
      if (!text) {
        setTip(null)
        return
      }
      const r = svgRef.current!.parentElement!.getBoundingClientRect()
      setTip({ x: clientX - r.left, y: clientY - r.top, text })
    },
    [tipFor],
  )

  /**
   * 视窗变了而鼠标没动，光标底下换了一个单元，提示却还留着上一个。
   * 用最后的光标位置重新解析一次。
   */
  useEffect(() => {
    const p = lastPtr.current
    if (!p || !tip) return
    const el = document.elementFromPoint(p.x, p.y)
    if (!el || !svgRef.current?.contains(el)) {
      setTip(null)
      return
    }
    showTip(p.x, p.y, el)
    // 只在视窗/分片变化时重算；tip 自身变化不触发，否则会自激
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, shardTick])

  /* ---------- 点击 ---------- */
  const handleClick = (e: React.MouseEvent) => {
    if (moved.current > DRAG_MIN || frozen) return
    const hit = hitOf(e.target as Element) ?? downHit.current
    if (!hit) return
    if (clickTimer.current) clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(() => {
      // 层级过了半程，点击落到区县；否则还是选市
      if (hit.kind === 'county' && t >= 0.5) {
        const shard = store?.get(hit.parent)
        const u = shard?.units.find((x) => x.a === hit.adcode)
        if (u) {
          onPickCounty({
            adcode: hit.adcode,
            parent: hit.parent,
            name: u.n,
            siblingCount: shard!.units.length,
          })
        }
      } else {
        onPick(hit.kind === 'county' ? hit.parent : hit.adcode)
      }
    }, 200) // 等一手，看看是不是双击
  }

  /**
   * 双击 = 直接记录当前层级的这个单元。
   *
   * 不要拿双击去做下钻：「双击直接记录」是这个应用原本就有的习惯，
   * 用下钻劫持它，老用户按老习惯操作会得到一次莫名其妙的缩放。
   * 下钻的入口是滚轮/捏合放大，以及抽屉里那个显式按钮。
   */
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (frozen) return
    const hit = hitOf(e.target as Element) ?? downHit.current
    if (!hit) return
    e.preventDefault()
    if (clickTimer.current) clearTimeout(clickTimer.current)
    if (hit.kind === 'county' && t >= 0.5) {
      const u = store?.get(hit.parent)?.units.find((x) => x.a === hit.adcode)
      if (u) onPickDouble({ level: 'county', adcode: hit.adcode, parent: hit.parent, name: u.n })
      return
    }
    onPickDouble({ level: 'city', adcode: hit.kind === 'county' ? hit.parent : hit.adcode })
  }

  useEffect(() => () => { if (clickTimer.current) clearTimeout(clickTimer.current) }, [])

  /**
   * 涟漪画在哪：下钻到位、分片已加载、且这条是区县级记录时画在区县锚点上，
   * 否则落回市锚点。回放里区县记录的 adcode 已经折叠成市码了，所以市锚点总能取到 ——
   * 不折叠的话 byCode.get(区县码) 是 undefined，那条记录回放时一点涟漪都没有。
   */
  const pingAt = useMemo((): [number, number] | null => {
    if (!ping) return null
    if (ping.countyAdcode !== null && t > 0.5) {
      const u = store?.get(ping.adcode)?.units.find((x) => x.a === ping.countyAdcode)
      if (u) return [u.c[0], u.c[1]]
    }
    const city = byCode.get(ping.adcode)
    return city ? [city.c[0], city.c[1]] : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ping, t, byCode, store, shardTick])

  /* ---------- 面包屑 ---------- */
  const crumbs: Crumb[] = useMemo(() => {
    const out: Crumb[] = [{ label: '中国', view: { ...baseView } }]
    if (t <= 0) return [{ label: '中国', view: null }]
    const center = drilled ?? nearestCity(data, cityBBox, view)
    const u = center !== null ? byCode.get(center) : null
    if (u) {
      const pb = provBBox.get(u.p)
      out.push({
        label: u.p.replace(/(省|市|自治区|特别行政区)$/, ''),
        view: pb ? fitBox(pb, aspect, 1.12) : null,
      })
      if (t > 0.45) {
        const b = cityBBox.get(u.a)
        out.push({ label: u.n, view: null })
        // 当前所在的一级不可点，上一级可点
        if (b) out[out.length - 2].view = fitBox(provBBox.get(u.p)!, aspect, 1.12)
      }
    }
    if (out.length > 1) out[out.length - 1] = { ...out[out.length - 1], view: null }
    return out
  }, [t, drilled, view, data, byCode, cityBBox, provBBox, aspect, baseView])

  /* ---------- 对外操作 ---------- */
  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => doZoom(0.75, view.x + view.w / 2, view.y + view.h / 2),
      zoomOut: () => doZoom(1.33, view.x + view.w / 2, view.y + view.h / 2),
      reset: () => {
        setDrilled(null)
        flyTo({ ...baseView })
      },
      focus: (adcode: number) => {
        const u = byCode.get(adcode)
        if (!u) return
        const w = 260
        const h = (w * baseView.h) / baseView.w
        flyTo({ x: u.c[0] - w / 2, y: u.c[1] - h / 2, w, h })
      },
      drillInto: (adcode: number) => {
        const b = cityBBox.get(adcode)
        if (!b || !band) return
        setDrilled(adcode)
        flyTo(drillBox(b, aspect, band))
      },
      prefetch: (adcode: number) => {
        if (!store) return
        store.loadIndex().then(() => store.load(adcode).then(() => setShardTick((n) => n + 1)))
      },
    }),
    [byCode, view, doZoom, baseView, cityBBox, band, aspect, flyTo, store],
  )

  return (
    <>
      <svg
        ref={svgRef}
        id="map"
        aria-label="地图"
        className={drag.current?.cap ? 'drag' : undefined}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        style={{ ['--t' as string]: t.toFixed(3), ['--k' as string]: k.toFixed(5) } as React.CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={(e) => {
          endDrag(e)
          setTip(null)
          lastPtr.current = null
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
          {/* 斜纹也在用户坐标里，尺寸跟着视窗缩，否则放大后粗成色块 */}
          {/*
            斜纹。两处坑：
            1) 尺寸在用户坐标里，要乘 k 抵掉 viewBox 放大，否则放大后粗成色块。
            2) 颜色必须写在 style 里，不能写成 fill="var(--lit-soft)" —— var() 只在
               CSS 声明里有效，SVG 表现属性是按 SVG 值解析的，写成属性等于无效值，
               pattern 什么都画不出来，区县会整片变透明（而且不报任何错）。
          */}
          <pattern
            id="hatch"
            width={6 * k}
            height={6 * k}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width={6 * k} height={6 * k} style={{ fill: 'var(--lit-soft)' }} />
            <line
              x1="0"
              y1="0"
              x2="0"
              y2={6 * k}
              strokeWidth={k}
              style={{ stroke: 'var(--lit)', opacity: 0.42 }}
            />
          </pattern>
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

        <CityFillLayers paths={paths} lit={lit} fillOf={fillOfCity} selected={selected} />

        {t > 0 && (
          <CountyLayer
            shards={visibleShards}
            countyColors={countyColors}
            inheritCities={inheritCities}
            selected={countySel}
            fillOf={fillFor}
          />
        )}

        {/* 市界描边层必须在区县层之上，否则被区县填色糊掉 */}
        <CityLineLayer paths={paths} focus={t > 0 ? drilled : null} />

        <ProvinceLayer data={data} />
        <CityLabelLayer paths={paths} lit={lit} />

        <g id="fxLayer">
          {pingAt && (
            <g key={ping!.key}>
              <circle cx={pingAt[0]} cy={pingAt[1]} r={PING_R * k} className="ping" stroke={ping!.colors[0]} />
              {/* 重复到访：补一圈延迟出发的涟漪，跟第一次去区分开 */}
              {ping!.repeat && (
                <circle
                  cx={pingAt[0]}
                  cy={pingAt[1]}
                  r={PING_R * k}
                  className="ping delay"
                  stroke={ping!.colors[ping!.colors.length - 1]}
                />
              )}
            </g>
          )}
        </g>
      </svg>

      <Breadcrumb crumbs={crumbs} onGo={(v) => { setDrilled(null); flyTo(v) }} />

      <InsetMap data={data} inset={inset} lit={lit} fillOf={fillOfCity} selected={selected} />

      {/*
        透明度用内联值，不要靠 CSS 里的 var(--t)：--t 写在 <svg> 的内联样式上，
        而这个图例是 svg 的兄弟节点，拿不到那个变量，会一直退回默认值 0 —— 图例永远不显示。
      */}
      <div id="ctyLegend" hidden={t === 0} style={{ opacity: t }} aria-hidden="true">
        <div><i className="f-lit" />已记到区县</div>
        <div><i className="f-inh" />只记到市，区县待补</div>
        <div><i className="f-blk" />没去过</div>
      </div>

      {loadingShards && <div id="shardBar" aria-hidden="true" />}

      {tip && (
        <div id="tip" className="on" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </div>
      )}
    </>
  )
})

/** 视窗中心落在哪个市里；落在缝里就取锚点最近的 */
function nearestCity(data: MapData, bbox: Map<number, BBox>, view: View): number | null {
  const cx = view.x + view.w / 2
  const cy = view.y + view.h / 2
  let best: number | null = null
  let bd = Infinity
  for (const u of data.u) {
    const b = bbox.get(u.a)
    if (!b) continue
    if (cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1) {
      const d = (u.c[0] - cx) ** 2 + (u.c[1] - cy) ** 2
      if (d < bd) { bd = d; best = u.a }
    }
  }
  if (best !== null) return best
  for (const u of data.u) {
    const d = (u.c[0] - cx) ** 2 + (u.c[1] - cy) ** 2
    if (d < bd) { bd = d; best = u.a }
  }
  return best
}

export default MapCanvas
