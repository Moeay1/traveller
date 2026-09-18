import type { Person, Visit } from '@prisma/client'
import { serializePerson, type PersonDTO } from './person'

/** 前端用的形状：日期压成 YYYY-MM-DD，去掉时区带来的歧义。 */
export type VisitLevel = 'city' | 'county'

export type VisitDTO = {
  id: string
  country: string
  /** 记录所在地图单元的代码。是市码还是区县码由 level 决定 */
  adcode: number
  level: VisitLevel
  /** 区县级记录的父级市 adcode；市级记录为 null */
  parentAdcode: number | null
  cityName: string
  province: string
  visitedOn: string
  note: string
  /** 这次到访有谁参与，可能为空 */
  persons: PersonDTO[]
}

export function serializeVisit(v: Visit & { persons?: Person[] }): VisitDTO {
  return {
    id: v.id,
    country: v.country,
    adcode: v.adcode,
    level: v.level as VisitLevel,
    parentAdcode: v.parentAdcode,
    cityName: v.cityName,
    province: v.province,
    visitedOn: v.visitedOn.toISOString().slice(0, 10),
    note: v.note,
    persons: (v.persons ?? []).map(serializePerson),
  }
}

/**
 * 一条记录在「市」这一层落在哪个单元上。
 *
 * 区县级记录要折叠到父级市 —— 全国层的点亮、统计、回放涟漪都按这个口径来，
 * 不然一条区县记录会让它所属的市看起来没去过。
 */
export function cityCodeOf(v: Pick<VisitDTO, 'adcode' | 'level' | 'parentAdcode'>): number {
  return v.level === 'county' && v.parentAdcode !== null ? v.parentAdcode : v.adcode
}
