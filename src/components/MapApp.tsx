'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import ChinaMap, { MapHandle } from './ChinaMap'
import CitySearch from './CitySearch'
import RegionSwitch from './RegionSwitch'
import Drawer, { DrawerMode } from './Drawer'
import Playback, { PingEvent } from './Playback'
import Sidebar, { Tab } from './Sidebar'
import { MapData } from '@/lib/mapdata'
import { VisitDTO } from '@/lib/visit'
import { PersonDTO, UNASSIGNED_COLOR } from '@/lib/person'
import { DEFAULT_REGION, REGIONS, RegionCode, regionOf } from '@/lib/regions'
import { stamp } from '@/lib/date'

type User = { id: string; email: string; displayName: string }

export default function MapApp({ user, initialRegion }: { user: User; initialRegion: RegionCode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [region, setRegion] = useState<RegionCode>(initialRegion)
  /** 各国地图数据按需加载，切过一次就缓存住 */
  const [maps, setMaps] = useState<Partial<Record<RegionCode, MapData>>>({})
  const [mapLoading, setMapLoading] = useState(false)
  const [visits, setVisits] = useState<VisitDTO[]>([])
  const [persons, setPersons] = useState<PersonDTO[]>([])
  const [tab, setTab] = useState<Tab>('trips')
  /** 手机上底部列表是否收起，收起后地图占满 */
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  /** 人物筛选：选中的人物 id；'none' 代表未指定人物的记录 */
  const [filterIds, setFilterIds] = useState<string[]>([])
  /** true = 严格匹配（这次到访的人恰好就是选中的这些，不含其他人） */
  const [filterExact, setFilterExact] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const [selected, setSelected] = useState<number | null>(null)
  const [mode, setMode] = useState<DrawerMode>('detail')
  const [editing, setEditing] = useState<VisitDTO | null>(null)
  const [open, setOpen] = useState(false)

  const [cutoff, setCutoff] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [ping, setPing] = useState<PingEvent | null>(null)
  const mapRef = useRef<MapHandle>(null)

  /* ---------- 初始加载 ---------- */
  useEffect(() => {
    let alive = true
    Promise.all([
      fetch(regionOf(initialRegion).data).then((r) => r.json() as Promise<MapData>),
      fetch('/api/visits').then((r) => r.json()),
      fetch('/api/persons').then((r) => r.json()),
    ])
      .then(([map, res, ps]) => {
        if (!alive) return
        setMaps({ [initialRegion]: map })
        setVisits(res.visits ?? [])
        setPersons(ps.persons ?? [])
      })
      .catch(() => alive && setError('加载失败，刷新页面重试'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [initialRegion])

  const data = maps[region] ?? null
  const conf = regionOf(region)

  const byCode = useMemo(() => new Map((data?.u ?? []).map((u) => [u.a, u])), [data])

  /**
   * 筛选语义是「与」：选中的人必须全都参与了这次到访。
   * 选一个人 = 他参与过的（含同行）；选两个人 = 他俩一起去的。
   */
  /** 当前国家的记录；地图、统计、回放都基于它 */
  const regionVisits = useMemo(() => visits.filter((v) => v.country === region), [visits, region])

  const shownVisits = useMemo(() => {
    if (!filterIds.length) return regionVisits
    return regionVisits.filter((v) => {
      const ids = new Set(v.persons.map((p) => p.id))
      const contains = filterIds.every((id) => (id === 'none' ? v.persons.length === 0 : ids.has(id)))
      if (!contains) return false
      // 严格模式再要求人数相等，也就是"没有别人参与"
      if (!filterExact) return true
      const wantNone = filterIds.includes('none')
      return wantNone ? v.persons.length === 0 : v.persons.length === filterIds.length
    })
  }, [regionVisits, filterIds, filterExact])

  /** 当前应当点亮的城市；回放时按截止时间过滤 */
  const lit = useMemo(() => {
    const s = new Set<number>()
    for (const v of shownVisits) {
      if (cutoff === null || stamp(v.visitedOn) <= cutoff) s.add(v.adcode)
    }
    return s
  }, [shownVisits, cutoff])

  /**
   * 每座城的颜色 = 这座城所有到访涉及的人的身份色（去重、按人物列表顺序）。
   * 一座城被不同人在不同时间去过，也会显示成多色。
   *
   * 筛选时只取被选中那几个人的颜色——「只看赵世昌」应该得到一张他的地图，
   * 而不是因为同行记录里还有别人就继续显示双色。
   */
  const cityColors = useMemo(() => {
    const order = new Map(persons.map((p, i) => [p.id, i]))
    const keep = filterIds.length ? new Set(filterIds) : null
    const m = new Map<number, string[]>()
    for (const v of shownVisits) {
      if (cutoff !== null && stamp(v.visitedOn) > cutoff) continue
      const cur = m.get(v.adcode) ?? []
      const people = keep ? v.persons.filter((p) => keep.has(p.id)) : v.persons
      if (people.length === 0) {
        if (!cur.includes(UNASSIGNED_COLOR)) cur.push(UNASSIGNED_COLOR)
      } else {
        for (const p of people) if (!cur.includes(p.color)) cur.push(p.color)
      }
      m.set(v.adcode, cur)
    }
    // 按人物面板里的顺序排，保证同样一组人在不同城市上的配色一致
    for (const [k, cs] of m) {
      m.set(
        k,
        [...cs].sort((a, b) => {
          const ia = persons.find((p) => p.color === a)
          const ib = persons.find((p) => p.color === b)
          return (ia ? order.get(ia.id)! : 99) - (ib ? order.get(ib.id)! : 99)
        }),
      )
    }
    return m
  }, [shownVisits, cutoff, persons, filterIds])

  const tripsOfSelected = useMemo(
    () =>
      visits
        .filter((v) => v.country === region && v.adcode === selected)
        .sort((a, b) => b.visitedOn.localeCompare(a.visitedOn)),
    [visits, region, selected],
  )

  const provinceProgress = useMemo((): [number, number] => {
    if (!data || selected === null) return [0, 0]
    const prov = byCode.get(selected)?.p
    if (!prov) return [0, 0]
    const cities = data.u.filter((u) => u.p === prov)
    const litSet = new Set(shownVisits.map((v) => v.adcode))
    return [cities.filter((u) => litSet.has(u.a)).length, cities.length]
  }, [data, byCode, selected, shownVisits])

  /* ---------- 交互 ---------- */
  const focusAndOpen = useCallback((adcode: number) => {
    mapRef.current?.focus(adcode)
    setSelected(adcode)
    setMode('detail')
    setEditing(null)
    setOpen(true)
  }, [])

  const openDetail = useCallback((adcode: number) => {
    setSelected(adcode)
    setMode('detail')
    setEditing(null)
    setOpen(true)
  }, [])

  const openForm = useCallback((adcode: number, visit: VisitDTO | null = null) => {
    setSelected(adcode)
    setEditing(visit)
    setMode('form')
    setOpen(true)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setSelected(null)
    setEditing(null)
  }, [])

  /** 切国家：没加载过的地图现取，取完缓存 */
  const switchRegion = useCallback(
    async (code: RegionCode) => {
      close()
      setRegion(code)
      // 写进地址栏，链接分享出去打开就是这个国家。
      // 用 replace 不用 push：来回切国家不该塞满浏览器的后退历史
      const qs = code === DEFAULT_REGION ? '' : `?country=${code}`
      router.replace(`${pathname}${qs}`, { scroll: false })
      if (maps[code]) return
      setMapLoading(true)
      try {
        const map = (await fetch(regionOf(code).data).then((r) => r.json())) as MapData
        setMaps((m) => ({ ...m, [code]: map }))
      } catch {
        setError(`${regionOf(code).name}地图加载失败`)
      } finally {
        setMapLoading(false)
      }
    },
    [maps, router, pathname, close],
  )

  const request = async (input: RequestInfo, init?: RequestInit) => {
    const res = await fetch(input, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.message ?? '操作失败')
    return body
  }

  const submit = async ({
    visitedOn,
    note,
    personIds,
  }: {
    visitedOn: string
    note: string
    personIds: string[]
  }) => {
    if (selected === null) return
    const unit = byCode.get(selected)
    if (!unit) return
    setBusy(true)
    setError('')
    try {
      if (editing) {
        const updated: VisitDTO = await request(`/api/visits/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ visitedOn, note, personIds }),
        })
        setVisits((vs) => vs.map((v) => (v.id === updated.id ? updated : v)))
      } else {
        const created: VisitDTO = await request('/api/visits', {
          method: 'POST',
          body: JSON.stringify({
            country: region,
            adcode: unit.a,
            cityName: unit.n,
            province: unit.p,
            visitedOn,
            note,
            personIds,
          }),
        })
        setVisits((vs) => [created, ...vs])
      }
      setMode('detail')
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (visit: VisitDTO) => {
    setBusy(true)
    setError('')
    try {
      await request(`/api/visits/${visit.id}`, { method: 'DELETE' })
      setVisits((vs) => vs.filter((v) => v.id !== visit.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败')
    } finally {
      setBusy(false)
    }
  }

  /** 取消点亮：删掉这座城市的全部到访 */
  const removeCity = async () => {
    if (selected === null) return
    setBusy(true)
    setError('')
    try {
      await request(`/api/visits?country=${region}&adcode=${selected}`, { method: 'DELETE' })
      setVisits((vs) => vs.filter((v) => !(v.country === region && v.adcode === selected)))
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败')
    } finally {
      setBusy(false)
    }
  }

  /** 人物列表里的到访计数由服务端算，改完统一重取，省得前端各处对齐 */
  const reloadPersons = async () => {
    const res = await fetch('/api/persons').then((r) => r.json())
    setPersons(res.persons ?? [])
  }

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const personProps = {
    persons,
    busy,
    onCreate: (input: { name: string; avatar: string | null; color: string }) =>
      withBusy(async () => {
        await request('/api/persons', { method: 'POST', body: JSON.stringify(input) })
        await reloadPersons()
      }),
    onChangeColor: (id: string, color: string) =>
      withBusy(async () => {
        await request(`/api/persons/${id}`, { method: 'PATCH', body: JSON.stringify({ color }) })
        await reloadPersons()
        await reloadVisits() // 到访里带着人物快照，一并刷新
      }),
    onRename: (id: string, name: string) =>
      withBusy(async () => {
        await request(`/api/persons/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) })
        await reloadPersons()
        await reloadVisits()
      }),
    onChangeAvatar: (id: string, avatar: string | null) =>
      withBusy(async () => {
        await request(`/api/persons/${id}`, { method: 'PATCH', body: JSON.stringify({ avatar }) })
        await reloadPersons()
        await reloadVisits()
      }),
    onDelete: (id: string) =>
      withBusy(async () => {
        await request(`/api/persons/${id}`, { method: 'DELETE' })
        await reloadPersons()
        await reloadVisits() // 他名下的到访会变成"未指定"
      }),
  }

  const reloadVisits = async () => {
    const res = await fetch('/api/visits').then((r) => r.json())
    setVisits(res.visits ?? [])
  }

  const startPlayback = () => {
    if (!shownVisits.length) {
      setError('还没有任何足迹记录')
      return
    }
    close()
    setPlaying(true)
  }

  const exitPlayback = () => {
    setPlaying(false)
    setCutoff(null)
    setPing(null)
  }

  const doPing = useCallback((e: PingEvent) => {
    setPing(e)
    // 动画 0.95s（重复到访那圈延后 0.28s 出发），留点余量再清
    setTimeout(() => setPing((cur) => (cur?.key === e.key ? null : cur)), 1400)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('playing', playing)
    return () => document.body.classList.remove('playing')
  }, [playing])

  if (loading) return <div className="loading">正在加载地图…</div>
  if (!data) return <div className="loading">{error || '地图数据加载失败'}</div>

  return (
    <div id="app" className={panelCollapsed ? 'panel-collapsed' : undefined}>
      <Sidebar
        data={data}
        visits={shownVisits}
        totalVisits={regionVisits.length}
        conf={conf}
        user={user}
        persons={persons}
        filterIds={filterIds}
        filterExact={filterExact}
        onToggleExact={() => setFilterExact((v) => !v)}
        hasUnassigned={visits.some((v) => v.persons.length === 0)}
        filterBreakdown={
          filterIds.length === 1 && filterIds[0] !== 'none'
            ? {
                solo: visits.filter(
                  (v) => v.persons.length === 1 && v.persons[0].id === filterIds[0],
                ).length,
                withOthers: visits.filter(
                  (v) => v.persons.length > 1 && v.persons.some((p) => p.id === filterIds[0]),
                ).length,
              }
            : null
        }
        onToggleFilter={(id) =>
          setFilterIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
        }
        onClearFilter={() => {
          setFilterIds([])
          setFilterExact(false)
        }}
        personProps={personProps}
        tab={tab}
        onTabChange={(t) => {
          setTab(t)
          setPanelCollapsed(false) // 点标签页说明是要看内容，顺手展开
        }}
        onFocus={focusAndOpen}
        collapsed={panelCollapsed}
        onToggleCollapse={() => setPanelCollapsed((v) => !v)}
      />

      <div id="stage">
        <div className="tools">
          <RegionSwitch
            value={region}
            counts={Object.fromEntries(
              REGIONS.map((r) => [r.code, visits.filter((v) => v.country === r.code).length]),
            )}
            onChange={switchRegion}
          />

          <CitySearch units={data.u} onPick={focusAndOpen} />
          <div className="zoom">
            <button onClick={() => mapRef.current?.zoomIn()} title="放大" aria-label="放大">
              ＋
            </button>
            <button onClick={() => mapRef.current?.zoomOut()} title="缩小" aria-label="缩小">
              －
            </button>
            <button onClick={() => mapRef.current?.reset()} title="复位" aria-label="复位">
              ⤾
            </button>
          </div>
          <button id="pyOpen" className="btn-play" onClick={startPlayback}>
            ▶ 回放足迹
          </button>
        </div>

        <ChinaMap
          ref={mapRef}
          key={region}
          baseView={conf.view}
          inset={conf.inset}
          data={data}
          lit={lit}
          cityColors={cityColors}
          selected={selected}
          frozen={playing}
          ping={ping}
          onPick={openDetail}
          onPickDouble={(a) => openForm(a)}
        />

        <div className="legend">
          <span>
            <i style={{ background: 'var(--land)', border: '1px solid var(--land-edge)' }} />
            未抵达
          </span>
          {persons.map((p) => (
            <span key={p.id}>
              <i style={{ background: p.color }} />
              {p.name}
            </span>
          ))}
          {visits.some((v) => v.persons.length === 0) && (
            <span>
              <i style={{ background: UNASSIGNED_COLOR }} />
              未指定
            </span>
          )}
          <span className="desktop-hint">单击看详情 · 双击直接记录</span>
          <span className="touch-hint">点城市看详情</span>
        </div>

        {playing && (
          <Playback visits={shownVisits} onCutoff={setCutoff} onPing={doPing} onExit={exitPlayback} />
        )}

        {mapLoading && <div className="map-loading">正在加载{conf.name}地图…</div>}

        {error && !playing && (
          <div className="auth-err" style={{ position: 'absolute', left: 26, bottom: 70, zIndex: 8 }}>
            {error}
          </div>
        )}
      </div>

      <Drawer
        open={open}
        unit={selected !== null ? byCode.get(selected) ?? null : null}
        mode={mode}
        trips={tripsOfSelected}
        hiddenByFilter={
          filterIds.length
            ? tripsOfSelected.length - tripsOfSelected.filter((t) => shownVisits.some((v) => v.id === t.id)).length
            : 0
        }
        provinceProgress={provinceProgress}
        editing={editing}
        persons={persons}
        conf={conf}
        busy={busy}
        onGoPersons={() => setTab('persons')}
        onClose={close}
        onStartCreate={() => selected !== null && openForm(selected)}
        onStartEdit={(v) => openForm(v.adcode, v)}
        onCancelForm={() => {
          setMode('detail')
          setEditing(null)
        }}
        onSubmit={submit}
        onDelete={remove}
        onDeleteCity={removeCity}
      />
    </div>
  )
}
