'use client'

import { useEffect, useState } from 'react'
import DatePicker from './DatePicker'
import Avatar from './Avatar'
import AvatarStack from './AvatarStack'
import { PersonDTO } from '@/lib/person'
import { Region } from '@/lib/regions'
import { MapUnit } from '@/lib/mapdata'
import { VisitDTO } from '@/lib/visit'
import { daysAgo, today } from '@/lib/date'

export type DrawerMode = 'detail' | 'form'

type Props = {
  open: boolean
  unit: MapUnit | null
  mode: DrawerMode
  /** 这座城市的全部到访，按日期倒序（详情不受筛选影响，这里给的是全部） */
  trips: VisitDTO[]
  /** 当前筛选下这座城有几条被隐藏了，仅用于提示 */
  hiddenByFilter: number
  /** 本省已点亮 / 本省城市总数 */
  provinceProgress: [number, number]
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
  /** 取消点亮：删掉这座城市的全部到访 */
  onDeleteCity: () => void
}

export default function Drawer({
  open, unit, mode, trips, hiddenByFilter, provinceProgress, editing, persons, conf, busy,
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
  }, [unit?.a, mode])

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

  return (
    <aside id="rail" className={open ? 'on' : undefined} aria-hidden={!open}>
      <section id="sheet">
        <div className="sh-top">
          <h3>{unit?.n ?? '—'}</h3>
          <em>{unit?.p ?? ''}</em>
          <button type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        {mode === 'detail' ? (
          <div>
            <div>
              <span className={`pill ${lit ? 'on' : 'off'}`}>
                <i />
                {lit ? '已点亮' : '未抵达'}
              </span>
            </div>

            <dl className="kv">
              <dt>所属{conf.groupLabel}</dt>
              <dd>{unit?.p}</dd>
              <dt>区划代码</dt>
              <dd>
                <span className="mono">{unit?.a}</span>
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
              <dt>本{conf.groupLabel}进度</dt>
              <dd>
                <span className="mono">
                  {provLit}/{provTotal}
                </span>{' '}
                {conf.unitLabel}已点亮
              </dd>
            </dl>

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
                {lit ? '再记一次到访' : '记录一次旅行'}
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
                  这会删掉 <b>{unit?.n}</b> 的全部 <b>{trips.length}</b> 条到访记录，地图上这座城会重新变灰。
                  删了就找不回来了。
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
                    {busy ? '删除中…' : `确认删除 ${trips.length} 条`}
                  </button>
                  <button type="button" className="btn btn-g" onClick={() => setConfirming(null)} disabled={busy}>
                    再想想
                  </button>
                </div>
              </div>
            )}
            {!lit && (
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
                {busy ? '保存中…' : editing ? '保存修改' : '点亮这座城'}
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
