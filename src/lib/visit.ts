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

/**
 * 侧栏的统计口径。
 *
 * `cityOnly` 是「有市级记录、但名下一个区县都没记」的城数 —— 待细化的提示就用它。
 * 注意它不等于「没有区县记录的城」：只有区县记录、没有市级记录的城（比如从一开始
 * 就记在区县上的）已经细化过了，不该催。
 */
export function visitStats(visits: readonly Pick<VisitDTO, 'adcode' | 'level' | 'parentAdcode'>[]): {
  cities: number
  counties: number
  cityOnly: number
} {
  const cities = new Set<number>()
  const counties = new Set<number>()
  const withCityLevel = new Set<number>()
  const withCountyLevel = new Set<number>()
  for (const v of visits) {
    cities.add(cityCodeOf(v))
    if (v.level === 'county') {
      counties.add(v.adcode)
      withCountyLevel.add(cityCodeOf(v))
    } else {
      withCityLevel.add(v.adcode)
    }
  }
  let cityOnly = 0
  for (const a of withCityLevel) if (!withCountyLevel.has(a)) cityOnly++
  return { cities: cities.size, counties: counties.size, cityOnly }
}
