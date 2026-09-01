'use client'

import { useRef, useState } from 'react'
import Avatar from './Avatar'
import { PERSON_COLORS, PersonDTO } from '@/lib/person'
import { fileToSquareDataUrl } from '@/lib/image'

type Props = {
  persons: PersonDTO[]
  busy: boolean
  onCreate: (input: { name: string; avatar: string | null; color: string }) => Promise<void>
  onRename: (id: string, name: string) => Promise<void>
  onChangeColor: (id: string, color: string) => Promise<void>
  onChangeAvatar: (id: string, avatar: string | null) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

export default function PersonPanel({
  persons, busy, onCreate, onRename, onChangeColor, onChangeAvatar, onDelete,
}: Props) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState<string | null>(null)
  const [color, setColor] = useState(PERSON_COLORS[0])
  /** 正在改色的人物 id */
  const [tinting, setTinting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const swapRef = useRef<HTMLInputElement>(null)
  const swapTarget = useRef<string | null>(null)

  const pickFile = async (file: File | undefined, apply: (d: string) => void) => {
    if (!file) return
    setError('')
    try {
      apply(await fileToSquareDataUrl(file))
    } catch {
      setError('这张图片读不出来，换一张试试')
    }
  }

  const reset = () => {
    setAdding(false)
    setName('')
    setAvatar(null)
    setColor(PERSON_COLORS[0])
    setError('')
  }

  const swatches = (current: string, onPick: (c: string) => void) => (
    <div className="swatches" role="group" aria-label="选择身份色">
      {PERSON_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={`swatch${c.toLowerCase() === current.toLowerCase() ? ' on' : ''}`}
          style={{ background: c }}
          aria-label={c}
          aria-pressed={c.toLowerCase() === current.toLowerCase()}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  )

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await onCreate({ name: name.trim(), avatar, color })
    reset()
  }

  return (
    <div className="pp">
      {persons.length === 0 && !adding && (
        <div className="empty">
          还没有人物
          <br />
          建一个，记录时就能选是谁
        </div>
      )}

      {persons.map((p) => (
        <div key={p.id}>
        <div className="prow">
          <button
            type="button"
            className="prow-av"
            title="换头像"
            onClick={() => {
              swapTarget.current = p.id
              swapRef.current?.click()
            }}
          >
            <Avatar person={p} size={34} />
            <i>换</i>
          </button>

          <div className="prow-id">
            {editing === p.id ? (
              <input
                value={editName}
                autoFocus
                maxLength={24}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    if (editName.trim() && editName.trim() !== p.name) await onRename(p.id, editName.trim())
                    setEditing(null)
                  }
                  if (e.key === 'Escape') setEditing(null)
                }}
                onBlur={() => setEditing(null)}
              />
            ) : (
              <>
                <b
                  onClick={() => {
                    setEditing(p.id)
                    setEditName(p.name)
                  }}
                  title="点一下改名"
                >
                  {p.name}
                </b>
                <span>{p.visitCount ?? 0} 次到访</span>
              </>
            )}
          </div>

          {confirming === p.id ? (
            <span className="mini">
              <em className="confirm-q">删掉？</em>
              <button
                type="button"
                className="del danger"
                disabled={busy}
                onClick={async () => {
                  setConfirming(null)
                  await onDelete(p.id)
                }}
              >
                删除
              </button>
              <button type="button" onClick={() => setConfirming(null)}>
                取消
              </button>
            </span>
          ) : (
            <span className="mini">
              <button
                type="button"
                onClick={() => setTinting(tinting === p.id ? null : p.id)}
                title="换身份色，地图上的点亮颜色也跟着变"
              >
                换色
              </button>
              {p.avatarUrl && (
                <button type="button" onClick={() => onChangeAvatar(p.id, null)} title="改回文字头像">
                  清除头像
                </button>
              )}
              <button type="button" className="del" onClick={() => setConfirming(p.id)}>
                删除
              </button>
            </span>
          )}
        </div>
        {tinting === p.id && (
          <div className="tint-row">
            {swatches(p.color, async (c) => {
              setTinting(null)
              await onChangeColor(p.id, c)
            })}
          </div>
        )}
        </div>
      ))}

      <input
        ref={swapRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const id = swapTarget.current
          await pickFile(e.target.files?.[0], (d) => id && onChangeAvatar(id, d))
          e.target.value = ''
        }}
      />

      {adding ? (
        <form className="padd" onSubmit={submit}>
          <div className="padd-top">
            <button type="button" className="prow-av" onClick={() => fileRef.current?.click()} title="上传头像">
              <Avatar
                person={name || avatar ? { name: name || '?', color, avatarUrl: avatar } : null}
                size={44}
                placeholder="＋"
              />
              <i>图</i>
            </button>
            <div style={{ flex: 1 }}>
              <label htmlFor="pname">姓名</label>
              <input
                id="pname"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="比如 赵世昌"
                maxLength={24}
                autoFocus
              />
            </div>
          </div>

          <label style={{ marginTop: 14 }}>身份色</label>
          {swatches(color, setColor)}
          <p className="padd-hint">
            这个颜色既是文字头像的底色，也是这个人在地图上点亮城市的颜色。
            <br />
            头像可以不传，会用姓名首字自动生成一个。
          </p>
          {error && <p className="auth-err">{error}</p>}

          <div className="acts">
            <button type="submit" className="btn btn-p" disabled={busy || !name.trim()}>
              {busy ? '保存中…' : '建好了'}
            </button>
            <button type="button" className="btn btn-g" onClick={reset} disabled={busy}>
              取消
            </button>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              await pickFile(e.target.files?.[0], setAvatar)
              e.target.value = ''
            }}
          />
        </form>
      ) : (
        <button type="button" className="padd-btn" onClick={() => setAdding(true)}>
          ＋ 新建人物
        </button>
      )}
    </div>
  )
}
