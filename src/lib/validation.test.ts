import { describe, expect, it } from 'vitest'
import { visitInputSchema } from './validation'

const base = {
  adcode: 530100,
  cityName: '昆明市',
  province: '云南省',
  visitedOn: '2026-01-01',
}

/** 取第一条错误信息，断言里读起来清楚些 */
function firstError(input: unknown): string | null {
  const r = visitInputSchema.safeParse(input)
  return r.success ? null : r.error.issues[0].message
}

describe('visitInputSchema 的粒度字段', () => {
  it('不传 level 时默认市级，parentAdcode 为 null', () => {
    const v = visitInputSchema.parse(base)
    expect(v.level).toBe('city')
    expect(v.parentAdcode).toBeNull()
  })

  it('区县级记录合法', () => {
    const v = visitInputSchema.parse({
      ...base,
      adcode: 530102,
      cityName: '五华区',
      level: 'county',
      parentAdcode: 530100,
    })
    expect(v.level).toBe('county')
    expect(v.parentAdcode).toBe(530100)
  })

  it('区县级必须带 parentAdcode', () => {
    expect(firstError({ ...base, adcode: 530102, level: 'county' }))
      .toMatch(/父级/)
    expect(firstError({ ...base, adcode: 530102, level: 'county', parentAdcode: null }))
      .toMatch(/父级/)
  })

  it('市级记录不该带 parentAdcode', () => {
    expect(firstError({ ...base, level: 'city', parentAdcode: 530100 }))
      .toMatch(/市级/)
  })

  it('parentAdcode 不能等于自己', () => {
    // 前端如果把市码当区县码传进来，会得到一条谁都不属于的记录
    expect(firstError({ ...base, adcode: 530100, level: 'county', parentAdcode: 530100 }))
      .toMatch(/不能等于/)
  })

  it('目前只有中国有区县这一层', () => {
    expect(firstError({ ...base, country: 'JP', adcode: 13, level: 'county', parentAdcode: 13000 }))
      .toMatch(/中国/)
  })

  it('level 只接受这两个值', () => {
    expect(visitInputSchema.safeParse({ ...base, level: 'province' }).success).toBe(false)
  })
})
