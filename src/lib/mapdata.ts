export type MapUnit = {
  /** 城市名 */ n: string
  /** 行政区划代码 */ a: number
  /** 所属省份 */ p: string
  /** 标注锚点 [x, y] */ c: [number, number]
  /** 多边形环，扁平坐标数组 */ g: number[][]
}

export type MapData = {
  w: number
  h: number
  u: MapUnit[]
  /** 九段线 */ jd: number[][]
  /** 省级轮廓 */ pv: number[][]
}

/** 扁平坐标数组转 SVG path。 */
export function ringToPath(r: number[]): string {
  let s = `M${r[0]} ${r[1]}`
  for (let i = 2; i < r.length; i += 2) s += `L${r[i]} ${r[i + 1]}`
  return s + 'Z'
}

export function unitToPath(u: MapUnit): string {
  return u.g.map(ringToPath).join('')
}

/** 地图初始视窗：大陆部分，南海诸岛走右下角小图。 */
export const BASE_VIEW = { x: -14, y: -14, w: 1028, h: 874 }

/** 标签上去掉行政级别后缀，"大理白族自治州" → "大理白族" */
export function shortName(name: string): string {
  return name.replace(/(市|自治州|地区|盟|特别行政区|省)$/, '')
}
