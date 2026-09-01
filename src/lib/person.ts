import type { Person } from '@prisma/client'

export type PersonDTO = {
  id: string
  name: string
  color: string
  /** 有头像时给出取图地址，没有则为 null，前端退回文字头像 */
  avatarUrl: string | null
  visitCount?: number
}

/**
 * 人物身份色。既是头像底色，也是这个人在地图上点亮城市的颜色，
 * 所以每个色都挑过：在浅灰底图上有足够对比，彼此之间色相拉得开。
 */
export const PERSON_COLORS = [
  '#C97514', // 琥珀
  '#2E7D6B', // 松绿
  '#A8442B', // 砖红
  '#3A6EA5', // 靛蓝
  '#6B5B95', // 紫灰
  '#7A6A3A', // 橄榄
  '#B0397A', // 品红
  '#2F6F8F', // 湖蓝
]

/** 未指定人物的到访用这个色 */
export const UNASSIGNED_COLOR = '#B9BEC6'

/** 新建人物时给个默认色，之后可以自己改 */
export function pickColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PERSON_COLORS[h % PERSON_COLORS.length]
}

/** 姓名取首字做默认头像：中文取第一个字，英文取首字母 */
export function initial(name: string): string {
  const t = name.trim()
  if (!t) return '?'
  return /^[a-zA-Z]/.test(t) ? t[0].toUpperCase() : t[0]
}

export function serializePerson(p: Person & { _count?: { visits: number } }): PersonDTO {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    // updatedAt 当版本号，换了头像浏览器就会重新取图
    avatarUrl: p.avatarData ? `/api/persons/${p.id}/avatar?v=${p.updatedAt.getTime()}` : null,
    ...(p._count ? { visitCount: p._count.visits } : {}),
  }
}
