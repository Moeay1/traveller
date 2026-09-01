import type { Person, Visit } from '@prisma/client'
import { serializePerson, type PersonDTO } from './person'

/** 前端用的形状：日期压成 YYYY-MM-DD，去掉时区带来的歧义。 */
export type VisitDTO = {
  id: string
  country: string
  adcode: number
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
    cityName: v.cityName,
    province: v.province,
    visitedOn: v.visitedOn.toISOString().slice(0, 10),
    note: v.note,
    persons: (v.persons ?? []).map(serializePerson),
  }
}
