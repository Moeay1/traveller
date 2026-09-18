import { describe, expect, it } from 'vitest'
import { cityCodeOf, visitStats, type VisitDTO, type VisitLevel } from './visit'

describe('cityCodeOf：折叠到市这一层', () => {
  it('市级记录就是它自己', () => {
    expect(cityCodeOf({ adcode: 530100, level: 'city', parentAdcode: null })).toBe(530100)
  })

  it('区县级记录折叠到父级市', () => {
    // 不折叠的话，一条「五华区」的记录会让昆明市看起来没去过
    expect(cityCodeOf({ adcode: 530102, level: 'county', parentAdcode: 530100 })).toBe(530100)
  })

  it('直辖市的区折叠到直辖市本身', () => {
    expect(cityCodeOf({ adcode: 110101, level: 'county', parentAdcode: 110000 })).toBe(110000)
  })

  it('区县级但父级缺失时退回自己，不返回 null', () => {
    // 理论上过不了校验，但真到了这一步宁可点亮一个错的单元，
    // 也不要让聚合里冒出 null 把整张图算崩
    expect(cityCodeOf({ adcode: 530102, level: 'county', parentAdcode: null })).toBe(530102)
  })
})

describe('visitStats：侧栏统计口径', () => {
  const v = (
    adcode: number,
    level: VisitLevel,
    parentAdcode: number | null = null,
  ): Pick<VisitDTO, 'adcode' | 'level' | 'parentAdcode'> => ({ adcode, level, parentAdcode })

  it('市级记录按市计数', () => {
    expect(visitStats([v(530100, 'city'), v(510100, 'city')])).toEqual({
      cities: 2, counties: 0, cityOnly: 2,
    })
  })

  it('同一座城多次到访只算一座', () => {
    expect(visitStats([v(530100, 'city'), v(530100, 'city')]).cities).toBe(1)
  })

  it('区县记录也点亮它所属的市', () => {
    // 只有区县记录、没有市级记录，这座城照样算点亮
    expect(visitStats([v(530102, 'county', 530100)])).toEqual({
      cities: 1, counties: 1, cityOnly: 0,
    })
  })

  it('cityOnly 只数「有市级记录但一个区县都没记」的城', () => {
    const s = visitStats([
      v(530100, 'city'),                  // 昆明：只记到市 → 待细化
      v(510100, 'city'),                  // 成都：有市级记录…
      v(510104, 'county', 510100),        // …也记了区县 → 不算待细化
      v(330102, 'county', 330100),        // 杭州：只有区县记录 → 不算待细化
    ])
    expect(s).toEqual({ cities: 3, counties: 2, cityOnly: 1 })
  })

  it('同一个区县多次到访只算一个', () => {
    expect(visitStats([v(530102, 'county', 530100), v(530102, 'county', 530100)]).counties).toBe(1)
  })
})
