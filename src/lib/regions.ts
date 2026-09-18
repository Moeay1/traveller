import type { Band } from './mapview'

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

/**
 * 下钻层：目前只有中国有。
 *
 * 分片按父级单元切，进入 band 时按需加载 —— 全国 332 片合计 2.6MB，
 * 一次性全下发没必要。names.json 是无几何名录，给跨层搜索用（P4）。
 */
export type DrillLevel = {
  key: 'county'
  /** 分片目录，实际路径是 `${dir}/${父级 adcode}.json` */
  dir: string
  /** 片数与体积索引，同时带着「没有下级的单元」清单 */
  index: string
  /** 全量名录，无几何 */
  names: string
  /** 统计口径的称呼 */
  unitLabel: string
  /** 视窗宽阈值 [淡入开始, 完全接管] */
  band: Band
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
    /** 210 约等于一两个省的跨度；110 以下区县完全接管 */
    drill: {
      key: 'county',
      dir: '/data/cn',
      index: '/data/cn/index.json',
      names: '/data/cn/names.json',
      unitLabel: '个区县',
      band: [210, 110],
    } as DrillLevel,
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
    /** 都道府県已经是这份数据的最细一层，没有下钻 */
    drill: null,
  },
] as const

export type RegionCode = (typeof REGIONS)[number]['code']
export type Region = (typeof REGIONS)[number]

export const DEFAULT_REGION: RegionCode = 'CN'

export function regionOf(code: string): Region {
  return REGIONS.find((r) => r.code === code) ?? REGIONS[0]
}

/** 这个国家有没有下钻层。没有的话所有下钻相关的 UI 都不出现 */
export function drillOf(code: string): DrillLevel | null {
  return regionOf(code).drill
}
