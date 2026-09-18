'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import MapCanvas, { MapHandle } from './map/MapCanvas'
import type { CountySel } from './map/CountyLayer'
import CitySearch, { type CountyName, type SearchHit } from './CitySearch'
import RegionSwitch from './RegionSwitch'
import Drawer, { DrawerMode, DrawerTarget } from './Drawer'
import Playback, { PingEvent } from './Playback'
import Sidebar, { Tab } from './Sidebar'
import { MapData } from '@/lib/mapdata'
import { cityCodeOf, visitStats, VisitDTO } from '@/lib/visit'
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
  /** 选中的区县（带名字，抽屉标题和写入都要用） */
  const [countySel, setCountySel] = useState<CountySel>(null)
  const [countyName, setCountyName] = useState<string>('')
  /** 当前下钻市的区县总数，用于「本市区县进度 x/y」；取不到就为 0 */
  const [countyTotal, setCountyTotal] = useState(0)
  /** 全量区县名录（无几何，112KB）。空闲时再取，不抢首屏 */
  const [countyNames, setCountyNames] = useState<CountyName[]>([])
  /** 每个市的区县数；没有下级的市不在表里。用来给下钻入口和进度分母 */
  const [countyCounts, setCountyCounts] = useState<Map<number, number>>(new Map())
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

  /**
   * 区县名录只给搜索用，而且要能搜到还没加载分片的区县，所以必须全量取。
   * 112KB，放到空闲时再拉，不跟首屏的地图和到访抢带宽。
   */
  useEffect(() => {
    const drill = conf.drill
    if (!drill || countyNames.length) return
    let alive = true
    const run = () => {
      fetch(drill.names)
        .then((r) => r.json())
        .then((list: CountyName[]) => alive && setCountyNames(list))
        .catch(() => {}) // 取不到就退化成只搜市，不打扰用户
      // 索引很小（10KB），顺手拿来做下钻入口的判断和进度分母
      fetch(drill.index)
        .then((r) => r.json())
        .then((idx: { shards: Record<string, { n: number }> }) => {
          if (!alive) return
          setCountyCounts(new Map(Object.entries(idx.shards).map(([k, v]) => [Number(k), v.n])))
        })
        .catch(() => {})
    }
    const idle = (window as unknown as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
    }).requestIdleCallback
    const id = idle ? idle(run, { timeout: 4000 }) : window.setTimeout(run, 1200)
    return () => {
      alive = false
      if (!idle) clearTimeout(id)
    }
  }, [conf, countyNames.length])

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
      // 折叠到市这一层：区县级记录点亮的是它所属的市
      if (cutoff === null || stamp(v.visitedOn) <= cutoff) s.add(cityCodeOf(v))
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
      const cur = m.get(cityCodeOf(v)) ?? []
      const people = keep ? v.persons.filter((p) => keep.has(p.id)) : v.persons
      if (people.length === 0) {
        if (!cur.includes(UNASSIGNED_COLOR)) cur.push(UNASSIGNED_COLOR)
      } else {
        for (const p of people) if (!cur.includes(p.color)) cur.push(p.color)
      }
      m.set(cityCodeOf(v), cur)
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

  /**
   * 区县自己的颜色。只有 level='county' 的记录才落在这里 ——
   * 市级记录不该把它名下所有区县都点亮，那是斜纹状态要表达的事。
   */
  const countyColors = useMemo(() => {
    const keep = filterIds.length ? new Set(filterIds) : null
    const m = new Map<number, string[]>()
    for (const v of shownVisits) {
      if (v.level !== 'county') continue
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
    return m
  }, [shownVisits, cutoff, filterIds])

  /**
   * 有市级记录、但名下一个区县记录都没有的市 —— 它的区县整片画成斜纹。
   * 「去过这个市，还没细化到区县」，这是老记录不回填也能有合理呈现的关键。
   */
  const inheritCities = useMemo(() => {
    const withCity = new Set<number>()
    const withCounty = new Set<number>()
    for (const v of shownVisits) {
      if (cutoff !== null && stamp(v.visitedOn) > cutoff) continue
      if (v.level === 'county') withCounty.add(cityCodeOf(v))
      else withCity.add(v.adcode)
    }
    for (const a of withCounty) withCity.delete(a)
    return withCity
  }, [shownVisits, cutoff])

  /** 抽屉的目标单元：区县优先（选了区县就是在看区县） */
  const drawerTarget = useMemo((): DrawerTarget | null => {
    if (countySel) {
      const city = byCode.get(countySel.parent)
      return {
        level: 'county',
        adcode: countySel.adcode,
        name: countyName || String(countySel.adcode),
        groupName: city?.n ?? '',
        parent: countySel.parent,
        parentName: city?.n ?? null,
      }
    }
    if (selected === null) return null
    const u = byCode.get(selected)
    if (!u) return null
    return { level: 'city', adcode: u.a, name: u.n, groupName: u.p, parent: null, parentName: null }
  }, [countySel, countyName, selected, byCode])

  const tripsOfSelected = useMemo(() => {
    if (!drawerTarget) return []
    return visits
      .filter(
        (v) =>
          v.country === region &&
          v.level === drawerTarget.level &&
          v.adcode === drawerTarget.adcode,
      )
      .sort((a, b) => b.visitedOn.localeCompare(a.visitedOn))
  }, [visits, region, drawerTarget])

  /**
   * 取消点亮的真实范围。按市删会连名下区县一起扫掉，确认文案必须报全。
   */
  const deleteScope = useMemo(() => {
    if (!drawerTarget) return { total: 0, counties: 0 }
    const own = tripsOfSelected.length
    if (drawerTarget.level === 'county') return { total: own, counties: 0 }
    const counties = visits.filter(
      (v) => v.country === region && v.level === 'county' && v.parentAdcode === drawerTarget.adcode,
    ).length
    return { total: own + counties, counties }
  }, [drawerTarget, tripsOfSelected, visits, region])

  /** 区县级且自己没记录时，父级市有几条市级记录 —— 决定要不要解释斜纹 */
  const inheritedFrom = useMemo(() => {
    if (drawerTarget?.level !== 'county' || tripsOfSelected.length) return 0
    return visits.filter(
      (v) => v.country === region && v.level === 'city' && v.adcode === drawerTarget.parent,
    ).length
  }, [drawerTarget, tripsOfSelected, visits, region])

  const provinceProgress = useMemo((): [number, number] => {
    if (!data || !drawerTarget) return [0, 0]
    if (drawerTarget.level === 'county') {
      const done = new Set(
        shownVisits
          .filter((v) => v.level === 'county' && v.parentAdcode === drawerTarget.parent)
          .map((v) => v.adcode),
      ).size
      // 分母优先取索引（启动后就有），拿不到再退回点击时从分片带上来的数
      return [done, countyCounts.get(drawerTarget.parent!) ?? countyTotal]
    }
    const prov = byCode.get(drawerTarget.adcode)?.p
    if (!prov) return [0, 0]
    const cities = data.u.filter((u) => u.p === prov)
    const litSet = new Set(shownVisits.map((v) => cityCodeOf(v)))
    return [cities.filter((u) => litSet.has(u.a)).length, cities.length]
  }, [data, byCode, drawerTarget, shownVisits, countyTotal, countyCounts])

  /* ---------- 交互 ---------- */
  /**
   * 选中一个市。必须同时清掉区县选中 —— drawerTarget 优先用 countySel，
   * 漏了这一步的话从搜索或侧栏列表点市，抽屉会停在上一个区县上。
   * 所以统一从这里出口，别在各个调用点分别记得清。
   */
  const selectCity = useCallback((adcode: number) => {
    setCountySel(null)
    setCountyName('')
    setSelected(adcode)
  }, [])

  const focusAndOpen = useCallback((adcode: number) => {
    mapRef.current?.focus(adcode)
    selectCity(adcode)
    setMode('detail')
    setEditing(null)
    setOpen(true)
  }, [selectCity])

  const openDetail = useCallback((adcode: number) => {
    selectCity(adcode)
    setMode('detail')
    setEditing(null)
    setOpen(true)
  }, [selectCity])

  /** 选中一个区县：下钻到父级市 + 选中它。分片里的区县总数到货后由点击补上 */
  const selectCounty = useCallback(
    (adcode: number, parent: number, name: string, siblingCount = 0) => {
      setSelected(null)
      setCountySel({ adcode, parent })
      setCountyName(name)
      setCountyTotal(siblingCount)
      setMode('detail')
      setEditing(null)
      setOpen(true)
    },
    [],
  )

  /** 点足迹列表里的一条：按它的层级决定是聚焦到市还是下钻到区县 */
  const focusVisit = useCallback(
    (v: VisitDTO) => {
      if (v.level === 'county' && v.parentAdcode !== null) {
        selectCounty(v.adcode, v.parentAdcode, v.cityName)
        mapRef.current?.drillInto(v.parentAdcode)
        return
      }
      focusAndOpen(v.adcode)
    },
    [selectCounty, focusAndOpen],
  )

  const openForm = useCallback((adcode: number, visit: VisitDTO | null = null) => {
    selectCity(adcode)
    setEditing(visit)
    setMode('form')
    setOpen(true)
  }, [selectCity])

  const close = useCallback(() => {
    setOpen(false)
    setSelected(null)
    setCountySel(null)
    setCountyName('')
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
    if (!drawerTarget) return
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
        const isCounty = drawerTarget.level === 'county'
        // 区县级：adcode 是区县码，cityName 存区县名，province 沿用父级市的省，
        // parentAdcode 必填 —— 服务端还会拿名录再校验一遍父子关系
        const parentUnit = isCounty ? byCode.get(drawerTarget.parent!) : null
        const created: VisitDTO = await request('/api/visits', {
          method: 'POST',
          body: JSON.stringify({
            country: region,
            adcode: drawerTarget.adcode,
            level: drawerTarget.level,
            parentAdcode: isCounty ? drawerTarget.parent : null,
            cityName: drawerTarget.name,
            province: isCounty ? parentUnit?.p ?? '' : drawerTarget.groupName,
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

  /**
   * 取消点亮。传市码时服务端会连它名下的区县记录一起删（OR 语义），
   * 所以本地也要按同样的口径过滤，不然列表和地图会短暂不一致。
   */
  const removeCity = async () => {
    if (!drawerTarget) return
    const a = drawerTarget.adcode
    setBusy(true)
    setError('')
    try {
      await request(`/api/visits?country=${region}&adcode=${a}`, { method: 'DELETE' })
      setVisits((vs) =>
        vs.filter((v) => !(v.country === region && (v.adcode === a || v.parentAdcode === a))),
      )
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
        onFocus={focusVisit}
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

          <CitySearch
            units={data.u}
            counties={countyNames}
            onPick={(hit) => {
              if (hit.level === 'city') {
                focusAndOpen(hit.adcode)
                return
              }
              // 选中一个区县 = 下钻到它所属的市 + 选中该区县
              selectCounty(hit.adcode, hit.parent, hit.name)
              mapRef.current?.drillInto(hit.parent)
            }}
          />
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

        <MapCanvas
          ref={mapRef}
          key={region}
          baseView={conf.view}
          inset={conf.inset}
          drill={conf.drill}
          data={data}
          lit={lit}
          cityColors={cityColors}
          countyColors={countyColors}
          inheritCities={inheritCities}
          selected={selected}
          countySel={countySel}
          frozen={playing}
          ping={ping}
          onPick={openDetail}
          onPickDouble={(hit) => {
            if (hit.level === 'county') {
              selectCounty(hit.adcode, hit.parent, hit.name)
              setMode('form')
              setEditing(null)
              return
            }
            openForm(hit.adcode)
          }}
          onPickCounty={(sel) =>
            selectCounty(sel.adcode, sel.parent, sel.name, sel.siblingCount)
          }
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
          <span className="desktop-hint">
            单击看详情 · 双击直接记录{conf.drill ? ' · 滚轮放大看区县' : ''}
          </span>
          <span className="touch-hint">
            点城市看详情{conf.drill ? ' · 捏合放大看区县' : ''}
          </span>
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
        target={drawerTarget}
        mode={mode}
        trips={tripsOfSelected}
        hiddenByFilter={
          filterIds.length
            ? tripsOfSelected.length - tripsOfSelected.filter((t) => shownVisits.some((v) => v.id === t.id)).length
            : 0
        }
        provinceProgress={provinceProgress}
        inheritedFrom={inheritedFrom}
        deleteScope={deleteScope}
        countyCoverage={
          drawerTarget && drawerTarget.level === 'city'
            ? [
                new Set(
                  shownVisits
                    .filter((v) => v.level === 'county' && v.parentAdcode === drawerTarget.adcode)
                    .map((v) => v.adcode),
                ).size,
                countyCounts.get(drawerTarget.adcode) ?? 0,
              ]
            : [0, 0]
        }
        onDrillIn={() => {
          if (drawerTarget) mapRef.current?.drillInto(drawerTarget.adcode)
        }}
        editing={editing}
        persons={persons}
        conf={conf}
        busy={busy}
        onGoPersons={() => setTab('persons')}
        onClose={close}
        onStartCreate={() => {
          setMode('form')
          setEditing(null)
          setOpen(true)
        }}
        onStartEdit={(v) => {
          setEditing(v)
          setMode('form')
          setOpen(true)
        }}
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
