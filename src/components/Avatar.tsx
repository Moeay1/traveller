'use client'

import { initial } from '@/lib/person'
import { PersonDTO } from '@/lib/person'

type Props = {
  person: Pick<PersonDTO, 'name' | 'color' | 'avatarUrl'> | null
  size?: number
  /** 未指定人物时的占位 */
  placeholder?: string
}

export default function Avatar({ person, size = 28, placeholder = '?' }: Props) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) }

  if (!person) {
    return (
      <span className="av av-empty" style={style} aria-hidden="true">
        {placeholder}
      </span>
    )
  }

  if (person.avatarUrl) {
    return (
      // 头像走自己的接口、尺寸固定且已在客户端压过，用原生 img 更省事
      // eslint-disable-next-line @next/next/no-img-element
      <img className="av" style={style} src={person.avatarUrl} alt={person.name} />
    )
  }

  return (
    <span className="av" style={{ ...style, background: person.color }} title={person.name}>
      {initial(person.name)}
    </span>
  )
}
