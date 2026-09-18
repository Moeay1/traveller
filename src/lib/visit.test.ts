import { describe, expect, it } from 'vitest'
import { cityCodeOf } from './visit'

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
