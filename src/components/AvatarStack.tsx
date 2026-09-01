'use client'

import Avatar from './Avatar'
import { PersonDTO } from '@/lib/person'

type Props = {
  persons: PersonDTO[]
  size?: number
  /** 最多显示几个，多出来的折成 +N */
  max?: number
  /** 是否在头像后面跟上姓名 */
  withNames?: boolean
}

export default function AvatarStack({ persons, size = 22, max = 3, withNames = false }: Props) {
  if (!persons.length) return null
  const shown = persons.slice(0, max)
  const rest = persons.length - shown.length

  return (
    <span className="avs" title={persons.map((p) => p.name).join('、')}>
      <span className="avs-pile" style={{ ['--av-size' as string]: `${size}px` }}>
        {shown.map((p) => (
          <Avatar key={p.id} person={p} size={size} />
        ))}
        {rest > 0 && (
          <span className="av avs-more" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
            +{rest}
          </span>
        )}
      </span>
      {withNames && <em>{persons.map((p) => p.name).join('、')}</em>}
    </span>
  )
}
