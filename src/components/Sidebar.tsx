'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Avatar from './Avatar'
import AvatarStack from './AvatarStack'
import PersonPanel from './PersonPanel'
import { MapData } from '@/lib/mapdata'
import { cityCodeOf, visitStats, VisitDTO } from '@/lib/visit'
import { PersonDTO } from '@/lib/person'
import { Region } from '@/lib/regions'

type Props = {
  data: MapData
  /** 已按筛选过滤后的记录 */
  visits: VisitDTO[]
  /** 未筛选时的总条数（当前国家），用来提示筛掉了多少 */
  totalVisits: number
  /** 当前国家的配置：单元和分组的称呼、统计口径都跟着它 */
  conf: Region
  user: { displayName: string; email: string }
  persons: PersonDTO[]
  filterIds: string[]
  filterExact: boolean
  onToggleExact: () => void
  hasUnassigned: boolean
  /** 只选中一个人时，拆出"单独去"和"同行"各多少条 */
  filterBreakdown: { solo: number; withOthers: number } | null
  onToggleFilter: (id: string) => void
  onClearFilter: () => void
  personProps: React.ComponentProps<typeof PersonPanel>
  tab: Tab
  onTabChange: (t: Tab) => void
  onFocus: (adcode: number) => void
  /** 手机上底部面板是否收起 */
  collapsed: boolean
  onToggleCollapse: () => void
}

export type Tab = 'trips' | 'provinces' | 'persons'

export default function Sidebar({
  data, visits, totalVisits, conf, user, persons, personProps, filterIds, filterExact,
  onToggleExact, hasUnassigned, filterBreakdown, onToggleFilter, onClearFilter,
  tab, onTabChange, onFocus, collapsed, onToggleCollapse,
}: Props) {
  const filtering = filterIds.length > 0
  // 抓手支持点一下切换，也支持上下滑
  const dragY = useRef<number | null>(null)
  const handlePointerUp = (e: React.PointerEvent) => {
    const start = dragY.current
    dragY.current = null
    if (start === null) return
    const dy = e.clientY - start
    if (Math.abs(dy) < 12) onToggleCollapse()          // 位移太小当点击
    else if (dy > 0 && !collapsed) onToggleCollapse()  // 下滑收起
    else if (dy < 0 && collapsed) onToggleCollapse()   // 上滑展开
  }
  const [signingOut, setSigningOut] = useState(false)
  const router = useRouter()

  // 折叠到市这一层：一条区县记录点亮的是它所属的市
  const litCities = useMemo(() => new Set(visits.map((v) => cityCodeOf(v))), [visits])
  const stats = useMemo(() => visitStats(visits), [visits])
  const litProvinces = useMemo(() => new Set(visits.map((v) => v.province)), [visits])
  const total = data.u.length
  const pct = (litCities.size / total) * 100

  const byYear = useMemo(() => {
    const groups = new Map<string, VisitDTO[]>()
    for (const v of visits) {
      const y = v.visitedOn.slice(0, 4)
      const arr = groups.get(y)
      if (arr) arr.push(v)
      else groups.set(y, [v])
    }
    return [...groups.entries()]
  }, [visits])

  const provinces = useMemo(() => {
    const g = new Map<string, { total: number; lit: number }>()
    for (const u of data.u) {
      const row = g.get(u.p) ?? { total: 0, lit: 0 }
      row.total++
      if (litCities.has(u.a)) row.lit++
      g.set(u.p, row)
    }
    return [...g.entries()].sort(
      (a, b) => b[1].lit / b[1].total - a[1].lit / a[1].total || b[1].lit - a[1].lit,
    )
  }, [data, litCities])

  const signOut = async () => {
    setSigningOut(true)
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
    router.refresh()
  }

  return (
    <aside id="left">
      <button
        type="button"
        className="left-handle"
        aria-expanded={!collapsed}
        aria-label={collapsed ? '展开足迹列表' : '收起足迹列表'}
        onPointerDown={(e) => (dragY.current = e.clientY)}
        onPointerUp={handlePointerUp}
      >
        <i />
        {collapsed && (
          <em>
            {litCities.size} 座城 · {visits.length} 次到访
          </em>
        )}
      </button>

      <div className="brand">
        <h1>旅痕</h1>
        <p>CHINA FOOTPRINT MAP</p>
      </div>

      <div className="statcard">
        <div className="stats">
          <div className="stat">
            <b>{litCities.size}</b>
            <span>已点亮</span>
          </div>
          <div className="stat">
            <b>{litProvinces.size}</b>
            <span>{conf.groupStat}</span>
          </div>
          <div className="stat">
            <b>
              {pct.toFixed(1)}
              <small style={{ fontSize: 13 }}>%</small>
            </b>
            <span>{conf.name}覆盖</span>
          </div>
        </div>
        <div className="bar">
          <i style={{ width: `${pct}%` }} />
        </div>
        {/* 区县这一层只有中国有，没有 drill 配置的国家不显示 */}
        {conf.drill && (stats.counties > 0 || stats.cityOnly > 0) && (
          <p className="substat">
            {stats.counties > 0 && (
              <span>
                已记 <b className="mono">{stats.counties}</b> 个区县
              </span>
            )}
            {stats.cityOnly > 0 && (
              <span className="todo">
                <b className="mono">{stats.cityOnly}</b> 座城只记到市
              </span>
            )}
          </p>
        )}
      </div>

      {persons.length > 0 && (
        <div className="filter">
          {persons.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`fchip${filterIds.includes(p.id) ? ' on' : ''}`}
              style={filterIds.includes(p.id) ? { borderColor: p.color, color: p.color } : undefined}
              aria-pressed={filterIds.includes(p.id)}
              onClick={() => onToggleFilter(p.id)}
            >
              <Avatar person={p} size={18} />
              {p.name}
            </button>
          ))}
          {hasUnassigned && (
            <button
              type="button"
              className={`fchip${filterIds.includes('none') ? ' on' : ''}`}
              aria-pressed={filterIds.includes('none')}
              onClick={() => onToggleFilter('none')}
            >
              未指定
            </button>
          )}
          {filtering && (
            <>
              <button
                type="button"
                className={`fchip exact${filterExact ? ' on' : ''}`}
                aria-pressed={filterExact}
                onClick={onToggleExact}
                title="只看恰好是这些人的到访，排除有其他人同行的"
              >
                {filterExact ? '✓ ' : ''}仅这些人
              </button>
              <button type="button" className="fchip clear" onClick={onClearFilter}>
                ✕ 全部
              </button>
            </>
          )}
        </div>
      )}

      {filtering && (
        <p className="filter-note">
          {filterExact
            ? filterIds.length > 1
              ? '恰好是这几个人的到访：'
              : '只有这个人的到访：'
            : filterIds.length > 1
              ? '这几个人都参与的到访：'
              : '这个人参与的到访：'}
          <b>{visits.length}</b> / {totalVisits} 条
          {/* 只选一个人且非严格模式时，把"单独/同行"拆开写清楚，
              否则用户看到的数字里混着同行记录，会以为算错了 */}
          {!filterExact && filterBreakdown && (
            <>
              <br />
              其中单独去 <b>{filterBreakdown.solo}</b> 条 · 与人同行 <b>{filterBreakdown.withOthers}</b> 条
            </>
          )}
        </p>
      )}

      <div className="tabs">
        <button className={tab === 'trips' ? 'on' : undefined} onClick={() => onTabChange('trips')}>
          足迹
        </button>
        <button className={tab === 'provinces' ? 'on' : undefined} onClick={() => onTabChange('provinces')}>
          {conf.groupLabel}覆盖
        </button>
        <button className={tab === 'persons' ? 'on' : undefined} onClick={() => onTabChange('persons')}>
          人物
        </button>
      </div>

      {tab === 'persons' ? (
        <div className="pane">
          <PersonPanel {...personProps} />
        </div>
      ) : tab === 'trips' ? (
        <div className="pane">
          {visits.length === 0 ? (
            <div className="empty">
              {conf.name}还没有点亮任何地方
              <br />
              在地图上点一下开始记录
            </div>
          ) : (
            <div className="tl">
              {byYear.map(([year, list]) => (
                <div key={year}>
                  <div className="yr">
                    <b>{year}</b>
                    <hr />
                    <em>{list.length} 次到访</em>
                  </div>
                  {list.map((v) => (
                    <div className="rec" key={v.id} onClick={() => onFocus(v.adcode)}>
                      {v.persons.length ? (
                        <AvatarStack persons={v.persons} size={22} max={3} />
                      ) : (
                        <span className="dot" />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h4>
                          {v.cityName}
                          <small>{v.province}</small>
                        </h4>
                        {v.note && <p>{v.note}</p>}
                      </div>
                      <time className="mono">{v.visitedOn.slice(5)}</time>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="pane">
          <div className="pv">
            {provinces.map(([name, s]) => {
              const p = (s.lit / s.total) * 100
              return (
                <div className={`pvrow${p === 100 ? ' full' : ''}`} key={name}>
                  <div className="pvtop">
                    <span>{name}</span>
                    <em className="mono">
                      {s.lit}/{s.total}
                    </em>
                  </div>
                  <div className="pvbar">
                    <i style={{ width: `${p}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="me">
        <span className="me-av">{user.displayName.slice(0, 1)}</span>
        <span className="me-id">
          <b>{user.displayName}</b>
          <span>{user.email}</span>
        </span>
        <button type="button" onClick={signOut} disabled={signingOut}>
          {signingOut ? '退出中…' : '登出'}
        </button>
      </div>
    </aside>
  )
}
