'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AvatarStack from './AvatarStack'
import { VisitDTO } from '@/lib/visit'
import { UNASSIGNED_COLOR } from '@/lib/person'
import { formatStamp, stamp } from '@/lib/date'

const DAY = 864e5
/** 每个事件占的时长，播放头在这段时间里从当前事件滑到下一个 */
const STEP_MS = 1000
/** 倍速档位：数字越大走得越快 */
const SPEEDS = [0.5, 1, 2] as const

export type PingEvent = { adcode: number; key: string; repeat: boolean; colors: string[] }

type Props = {
  visits: VisitDTO[]
  /** 每帧回报当前截止时间，null 表示退出回放 */
  onCutoff: (ts: number | null) => void
  /** 走到某次到访时触发涟漪；repeat 表示这座城之前已经亮过 */
  onPing: (e: PingEvent) => void
  onExit: () => void
}

export default function Playback({ visits, onCutoff, onPing, onExit }: Props) {
  const [f, setF] = useState(0)
  const [trackW, setTrackW] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1)
  const raf = useRef(0)
  const trackRef = useRef<HTMLDivElement>(null)
  const scrub = useRef(false)
  const seenCount = useRef(-1)
  /** 播放头当前位置，给 rAF 循环读，避免把 f 塞进 effect 依赖导致每帧重启 */
  const fRef = useRef(0)
  fRef.current = f

  /** 每一次到访都是时间轴上的一个事件，同一座城去两次就亮两次 */
  const events = useMemo(() => {
    const sorted = [...visits].sort((a, b) => a.visitedOn.localeCompare(b.visitedOn))
    const seen = new Map<number, number>()
    return sorted.map((v) => {
      const nth = (seen.get(v.adcode) ?? 0) + 1
      seen.set(v.adcode, nth)
      return { ...v, nth, repeat: nth > 1 }
    })
  }, [visits])

  const [t0, t1] = useMemo(() => {
    if (!events.length) return [0, 1]
    return [stamp(events[0].visitedOn) - 30 * DAY, stamp(events[events.length - 1].visitedOn) + 30 * DAY]
  }, [events])

  const cutoff = t0 + f * (t1 - t0)
  const shown = events.filter((v) => stamp(v.visitedOn) <= cutoff)
  const latest = shown[shown.length - 1]
  const cityCount = new Set(shown.map((v) => v.adcode)).size

  useEffect(() => {
    onCutoff(cutoff)
  }, [cutoff, onCutoff])

  // 时间前进跨过一次到访才放涟漪，往回拖不放
  useEffect(() => {
    if (seenCount.current >= 0 && shown.length > seenCount.current && latest) {
      onPing({
        adcode: latest.adcode,
        key: latest.id,
        repeat: latest.repeat,
        colors: latest.persons.length ? latest.persons.map((p) => p.color) : [UNASSIGNED_COLOR],
      })
    }
    seenCount.current = shown.length
  }, [shown.length, latest, onPing])

  /** 每个事件在时间轴上的位置，0–1 */
  const positions = useMemo(
    () => events.map((v) => (stamp(v.visitedOn) - t0) / (t1 - t0)),
    [events, t0, t1],
  )
  const posRef = useRef<number[]>([])
  posRef.current = positions

  // 按事件推进：落到一个事件上 → 停留 STEP_MS → 在这段时间里滑向下一个事件。
  // 这样每条记录得到的注视时间都一样，不会因为日期挨得近就一闪而过。
  useEffect(() => {
    if (!playing) return
    const pos = posRef.current
    if (!pos.length) return

    // 从播放头当前位置之后的那个事件接着走，支持拖动后继续播
    let cur = pos.findLastIndex((p) => p <= fRef.current + 1e-9)
    let from = cur < 0 ? 0 : pos[cur]
    let to = cur + 1 < pos.length ? pos[cur + 1] : 1
    let phase = 0
    let prev = 0

    const ease = (t: number) => 1 - Math.pow(1 - t, 3) // 出场快、临近下一个事件时放缓

    const tick = (now: number) => {
      if (!prev) prev = now
      phase += ((now - prev) * speed) / STEP_MS
      prev = now

      if (phase >= 1) {
        cur += 1
        if (cur >= pos.length - 1 && to >= 1) {
          setF(1)
          setPlaying(false)
          return
        }
        phase = 0
        from = pos[cur]
        to = cur + 1 < pos.length ? pos[cur + 1] : 1
      }

      setF(from + (to - from) * ease(Math.min(1, phase)))
      raf.current = requestAnimationFrame(tick)
    }

    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [playing, speed])

  const toggle = () => {
    if (f >= 1) setF(0)
    setPlaying((p) => !p)
  }

  const setFromX = useCallback((clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect()
    setF(Math.min(1, Math.max(0, (clientX - r.left) / r.width)))
  }, [])

  // 轨道宽度变了要重算刻度密度：窄屏上十几个年份挤在一起没法看
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setTrackW(entry.contentRect.width))
    ro.observe(el)
    setTrackW(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  const years = useMemo(() => {
    const all: { y: number; p: number }[] = []
    for (let y = new Date(t0).getFullYear(); y <= new Date(t1).getFullYear(); y++) {
      const p = (Date.parse(`${y}-01-01T00:00:00Z`) - t0) / (t1 - t0)
      if (p >= 0 && p <= 1) all.push({ y, p })
    }
    if (!all.length) return []

    // 每个年份标签大约占 34px，放不下就按 2 年、5 年、10 年递进抽稀
    const room = Math.max(1, Math.floor((trackW || 600) / 34))
    if (all.length <= room) return all
    const step = [2, 5, 10, 20, 50].find((n) => Math.ceil(all.length / n) <= room) ?? 100
    // 从末尾往回抽，保证最新那年一定有标签
    const kept = all.filter((_, i) => (all.length - 1 - i) % step === 0)
    return kept
  }, [t0, t1, trackW])

  return (
    <>
      {latest && (
        <div id="pyCap" key={latest.id}>
          <b>{latest.cityName}</b>
          {latest.repeat && <span className="nth">第 {latest.nth} 次</span>}
          <time className="mono">{latest.visitedOn}</time>
          {latest.persons.length > 0 && (
            <span className="who">
              <AvatarStack persons={latest.persons} size={18} withNames />
            </span>
          )}
          {latest.note && <p>{latest.note}</p>}
        </div>
      )}

      <div id="play">
        <button onClick={toggle} aria-label="播放 / 暂停">
          {playing ? '❚❚' : '▶'}
        </button>

        <div className="py-mid">
          <div className="py-top">
            <b className="mono">{formatStamp(cutoff)}</b>
            <span>
              {shown.length} / {events.length} 次到访 · {cityCount} 座城
            </span>
          </div>

          <div
            className="py-track"
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="时间轴"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(f * 100)}
            aria-valuetext={`${formatStamp(cutoff)}，${shown.length} 次到访、${cityCount} 座城`}
            onPointerDown={(e) => {
              scrub.current = true
              setPlaying(false)
              e.currentTarget.setPointerCapture(e.pointerId)
              setFromX(e.clientX)
            }}
            onPointerMove={(e) => scrub.current && setFromX(e.clientX)}
            onPointerUp={() => (scrub.current = false)}
            onPointerCancel={() => (scrub.current = false)}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 0.1 : 0.02
              if (e.key === 'ArrowLeft') {
                setPlaying(false)
                setF((v) => Math.max(0, v - step))
                e.preventDefault()
              }
              if (e.key === 'ArrowRight') {
                setPlaying(false)
                setF((v) => Math.min(1, v + step))
                e.preventDefault()
              }
              if (e.key === ' ') {
                toggle()
                e.preventDefault()
              }
            }}
          >
            <i className="py-fill" style={{ width: `${f * 100}%` }} />
            <div className="py-ticks">
              {years.map(({ y, p }) => (
                <span key={y}>
                  <i style={{ left: `${p * 100}%` }} />
                  <em style={{ left: `${p * 100}%` }}>{y}</em>
                </span>
              ))}
            </div>
            <span className="py-dot" style={{ left: `${f * 100}%` }} />
          </div>
        </div>

        <button
          className="py-speed"
          onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
          title={`每条记录停留 ${(STEP_MS / 1000 / speed).toFixed(1)} 秒，点击切换`}
        >
          {speed}×
        </button>

        <button className="py-exit" onClick={onExit}>
          退出
        </button>
      </div>
    </>
  )
}
