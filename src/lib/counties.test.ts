import { describe, expect, it } from 'vitest'
import { parentOfCounty, resolveCountyName } from './counties'

describe('区县 → 父级市', () => {
  it('普通地级市下的区', async () => {
    expect(await parentOfCounty(530102)).toBe(530100) // 五华区 → 昆明市
    expect(await parentOfCounty(510104)).toBe(510100) // 锦江区 → 成都市
  })

  it('直辖市：不能用 adcode 前缀去推父级', async () => {
    // floor(110101/100)*100 = 110100，但 cn.json 里北京是一个整体 110000。
    // 名录里有 86 个区县属于这种情况（四个直辖市），靠前缀推会得到
    // 一个地图上根本不存在的市码，那座城永远不会被点亮。
    expect(await parentOfCounty(110101)).toBe(110000) // 东城区 → 北京市
    expect(await parentOfCounty(310101)).toBe(310000) // 黄浦区 → 上海市
    expect(await parentOfCounty(500101)).toBe(500000) // 万州区 → 重庆市
    expect(await parentOfCounty(120101)).toBe(120000) // 和平区 → 天津市
  })

  it('不在名录里的码返回 null', async () => {
    expect(await parentOfCounty(999999)).toBeNull()
    // 海南直管县本身就是县级单元，停在市层，没有下级分片
    expect(await parentOfCounty(469002)).toBeNull()
  })

  it('能取到区县名，用于冗余存 cityName', async () => {
    expect(await resolveCountyName(530102)).toBe('五华区')
    expect(await resolveCountyName(999999)).toBeNull()
  })
})
