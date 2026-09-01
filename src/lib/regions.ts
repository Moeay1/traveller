/** 支持的国家/地区。加新国家只要在这里加一项 + 跑一次 scripts/build-map.py */
export type Inset = {
  /** 小图标题 */
  label: string
  /** 小图的 viewBox */
  viewBox: string
  /** 哪些单元画进小图（按名称） */
  units: readonly string[]
  /** 小图尺寸（px） */
  size: { w: number; h: number }
  /** 是否在小图里画九段线 */
  nineDash?: boolean
}

export const REGIONS = [
  {
    code: 'CN',
    name: '中国',
    data: '/data/cn.json',
    /** 初始视窗：大陆部分，南海诸岛走小图 */
    view: { x: -14, y: -14, w: 1028, h: 874 },
    unitLabel: '座城',
    groupLabel: '省份',
    groupStat: '省级区',
    inset: {
      label: '南海诸岛',
      viewBox: '650 795 210 358',
      units: ['三沙市'],
      size: { w: 104, h: 160 },
      nineDash: true,
    } as Inset,
  },
  {
    code: 'JP',
    name: '日本',
    data: '/data/jp.json',
    /** 初始视窗：主岛部分；冲绳离得太远，单独走小图，否则中间空出一大片 */
    view: { x: 253, y: -14, w: 761, h: 1076 },
    unitLabel: '个县',
    groupLabel: '地方',
    groupStat: '地方',
    inset: {
      label: '冲绳县',
      viewBox: '-8 915 413 136',
      units: ['冲绳县'],
      size: { w: 168, h: 62 },
    } as Inset,
  },
] as const

export type RegionCode = (typeof REGIONS)[number]['code']
export type Region = (typeof REGIONS)[number]

export const DEFAULT_REGION: RegionCode = 'CN'

export function regionOf(code: string): Region {
  return REGIONS.find((r) => r.code === code) ?? REGIONS[0]
}
