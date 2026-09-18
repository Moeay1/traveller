'use client'

import { useEffect, useState } from 'react'
import DatePicker from './DatePicker'
import Avatar from './Avatar'
import AvatarStack from './AvatarStack'
import { PersonDTO } from '@/lib/person'
import { Region } from '@/lib/regions'
import { VisitDTO, VisitLevel } from '@/lib/visit'
import { daysAgo, today } from '@/lib/date'

export type DrawerMode = 'detail' | 'form'

/**
 * 抽屉的目标单元。原来直接吃 MapUnit（只可能是市），加了区县之后
 * 两层共用同一套详情/表单，所以抽出这个形状 —— 由 MapApp 组装。
 */
export type DrawerTarget = {
  level: VisitLevel
  adcode: number
  name: string
  /** 市级：所属省；区县级：所属市名。标题下那行小字 */
  groupName: string
  /** 区县级才有：父级市 adcode / 市名 */
  parent: number | null
  parentName: string | null
}

type Props = {
  open: boolean
  target: DrawerTarget | null
  mode: DrawerMode
  /** 这座城市的全部到访，按日期倒序（详情不受筛选影响，这里给的是全部） */
  trips: VisitDTO[]
  /** 当前筛选下这座城有几条被隐藏了，仅用于提示 */
  hiddenByFilter: number
  /** 市级：本省已点亮/本省城市总数。区县级：本市已记区县/本市区县总数 */
  provinceProgress: [number, number]
  /**
   * 区县级且这个区县自己没有记录时，父级市的市级记录数。
   * 大于 0 就说明它在图上是斜纹而不是空白 —— 要把原因讲清楚。
   */
  inheritedFrom: number
  /** 正在编辑的那条；null 表示新增 */
  editing: VisitDTO | null
  /** 可选的人物 */
  persons: PersonDTO[]
  /** 当前国家配置，决定"省份/地方""座城/个县"这些称呼 */
  conf: Region
  /** 跳到左栏「人物」标签页去新建 */
  onGoPersons: () => void
  busy: boolean
  onClose: () => void
  onStartCreate: () => void
  onStartEdit: (v: VisitDTO) => void
  onCancelForm: () => void
  onSubmit: (payload: { visitedOn: string; note: string; personIds: string[] }) => void
  onDelete: (v: VisitDTO) => void
  /**
   * 取消点亮的真实范围。按市删会连它名下的区县记录一起扫掉（见 spec §3），
   * 所以确认文案必须报全，不能只报这一层自己的条数 ——
   * 一个破坏性确认低报删除范围，比不确认更糟。
   */
  deleteScope: { total: number; counties: number }
  /** 取消点亮：删掉这个单元（市则连名下区县）的全部到访 */
  onDeleteCity: () => void
}

export default function Drawer({
  open, target, mode, trips, hiddenByFilter, provinceProgress, inheritedFrom, editing, persons, conf, busy, deleteScope,
  onClose, onStartCreate, onStartEdit, onCancelForm, onSubmit, onDelete, onDeleteCity, onGoPersons,
}: Props) {
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const [personIds, setPersonIds] = useState<string[]>([])
  /** 待确认的删除：某条到访的 id，或 'city' 表示整座城市 */
  const [confirming, setConfirming] = useState<string | null>(null)

  // 进入表单时把字段填好：编辑用原值，新增用今天
  useEffect(() => {
    setConfirming(null)
  }, [target?.adcode, mode])

  useEffect(() => {
    if (mode !== 'form') return
    setDate(editing?.visitedOn ?? today())
    setNote(editing?.note ?? '')
    // 编辑时回填原来的人；新增时只有一个人物就默认选上
    setPersonIds(editing ? editing.persons.map((p) => p.id) : persons.length === 1 ? [persons[0].id] : [])
  }, [mode, editing, persons])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const lit = trips.length > 0
  const [provLit, provTotal] = provinceProgress
  const isCounty = target?.level === 'county'
  /** 「本省进度」这一行的称呼跟着层级换 */
  const progressLabel = isCounty ? '本市区县进度' : `本${conf.groupLabel}进度`
  const progressUnit = isCounty ? '个区县已记' : `${conf.unitLabel}已点亮`

  return (
    <aside id="rail" className={open ? 'on' : undefined} aria-hidden={!open}>
      <section id="sheet">
        <div className="sh-top">
          <h3>{target?.name ?? '—'}</h3>
          <em>{target?.groupName ?? ''}</em>
          <button type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        {mode === 'detail' ? (
          <div>
            <div>
              <span className={`pill ${lit ? 'on' : isCounty && inheritedFrom > 0 ? 'part' : 'off'}`}>
                <i />
                {lit ? '已点亮' : isCounty && inheritedFrom > 0 ? '市级记录覆盖' : '未抵达'}
              </span>
              {isCounty && <span className="lvl-tag">区县级</span>}
            </div>

            <dl className="kv">
              <dt>所属{isCounty ? '市' : conf.groupLabel}</dt>
              <dd>{target?.groupName}</dd>
              <dt>区划代码</dt>
              <dd>
                <span className="mono">{target?.adcode}</span>
              </dd>
              {lit && (
                <>
                  <dt>到访次数</dt>
                  <dd>
                    <span className="mono">{trips.length}</span> 次
                    {trips.length > 0 && (
                      <span style={{ color: 'var(--tx-dim)' }}>　最近 {daysAgo(trips[0].visitedOn)}</span>
                    )}
                  </dd>
                </>
              )}
              <dt>{progressLabel}</dt>
              <dd>
                <span className="mono">
                  {provLit}/{provTotal}
                </span>{' '}
                {progressUnit}
              </dd>
            </dl>

            {isCounty && !lit && inheritedFrom > 0 && (
              <p className="hint" style={{ marginTop: 12 }}>
                这个区县本身没有记录，但 <b>{target?.parentName}</b> 有 {inheritedFrom} 条市级记录，
                所以它在图上是斜纹、不是空白。在这里记一笔就能把它细化到区县。
              </p>
            )}

            {hiddenByFilter > 0 && (
              <p className="hint" style={{ marginTop: 12 }}>
                当前筛选下有 {hiddenByFilter} 条到访没显示在地图上，下面列的是这座城的全部记录。
              </p>
            )}

            {lit && (
              <div className="trips">
                {trips.map((t) => (
                  <div className="trip" key={t.id}>
                    <div className="trip-top">
                      {t.persons.length > 0 && (
                        <span className="trip-who">
                          <AvatarStack persons={t.persons} size={20} withNames />
                        </span>
                      )}
                      <time className="mono">{t.visitedOn}</time>
                      <em>{daysAgo(t.visitedOn)}</em>
                      <span className="mini">
                        {confirming === t.id ? (
                          <>
                            <em className="confirm-q">删掉这条？</em>
                            <button
                              type="button"
                              className="del danger"
                              disabled={busy}
                              onClick={() => {
                                setConfirming(null)
                                onDelete(t)
                              }}
                            >
                              删除
                            </button>
                            <button type="button" onClick={() => setConfirming(null)}>
                              取消
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" onClick={() => onStartEdit(t)}>
                              编辑
                            </button>
                            <button type="button" className="del" onClick={() => setConfirming(t.id)}>
                              删除
                            </button>
                          </>
                        )}
                      </span>
                    </div>
                    <p className={t.note ? undefined : 'none'}>{t.note || '没有写备注'}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="acts">
              <button type="button" className={`btn ${lit ? 'btn-g' : 'btn-p'}`} onClick={onStartCreate}>
                {lit ? '再记一次到访' : isCounty ? `在${target?.name}记一次` : '记录一次旅行'}
              </button>
              {lit && confirming !== 'city' && (
                <button type="button" className="btn btn-d" onClick={() => setConfirming('city')}>
                  取消点亮
                </button>
              )}
            </div>

            {confirming === 'city' && (
              <div className="confirm">
                <p>
                  这会删掉 <b>{target?.name}</b> 的全部 <b>{deleteScope.total}</b> 条到访记录
                  {deleteScope.counties > 0 && (
                    <>
                      （其中 <b>{deleteScope.counties}</b> 条记在它名下的区县上，一并删除）
                    </>
                  )}
                  ，地图上{isCounty ? '这个区县' : '这座城'}会重新变灰。删了就找不回来了。
                </p>
                <div className="acts">
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() => {
                      setConfirming(null)
                      onDeleteCity()
                    }}
                  >
                    {busy ? '删除中…' : `确认删除 ${deleteScope.total} 条`}
                  </button>
                  <button type="button" className="btn btn-g" onClick={() => setConfirming(null)} disabled={busy}>
                    再想想
                  </button>
                </div>
              </div>
            )}
            {!lit && !isCounty && (
              <p className="hint">
                在地图上 <kbd>双击</kbd> 灰色城市，可以跳过这一步直接填写。
              </p>
            )}
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              onSubmit({ visitedOn: date, note: note.trim(), personIds })
            }}
          >
            <label>
              是谁
              {persons.length > 1 && <span className="label-tip">可多选</span>}
            </label>
            {persons.length === 0 ? (
              <p className="pick-empty">
                还没有人物。
                <button type="button" onClick={onGoPersons}>
                  去新建一个
                </button>
                ，或者先不选，之后再补。
              </p>
            ) : (
              <div className="pick">
                {persons.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`pick-one${personIds.includes(p.id) ? ' on' : ''}`}
                    aria-pressed={personIds.includes(p.id)}
                    onClick={() =>
                      setPersonIds((cur) =>
                        cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id],
                      )
                    }
                  >
                    <Avatar person={p} size={26} />
                    {p.name}
                  </button>
                ))}
              </div>
            )}

            <label>抵达日期</label>
            <DatePicker value={date} onChange={setDate} />

            <label htmlFor="note">备注</label>
            <textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="和谁、去了哪儿、吃了什么…"
            />

            <div className="acts">
              <button type="submit" className="btn btn-p" disabled={busy}>
                {busy ? '保存中…' : editing ? '保存修改' : isCounty ? '点亮这个区县' : '点亮这座城'}
              </button>
              <button type="button" className="btn btn-g" onClick={onCancelForm} disabled={busy}>
                取消
              </button>
            </div>
          </form>
        )}
      </section>
    </aside>
  )
}
