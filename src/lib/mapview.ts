/**
 * 视窗数学。全是纯函数，地图组件里只调用不重写 —— 这几条规则在交互原型里
 * 逐条踩过坑，散在组件里改一次就会漂一次。
 */

export type View = { x: number; y: number; w: number; h: number }
export type BBox = { x0: number; y0: number; x1: number; y1: number }

/** 淡入开始、完全接管。两个数都是视窗宽（用户坐标） */
export type Band = readonly [number, number]

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** 扁平坐标环（[x,y,x,y,…]）的整体包围盒 */
export function bboxOfRings(rings: readonly number[][]): BBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const r of rings) {
    for (let i = 0; i < r.length; i += 2) {
      if (r[i] < x0) x0 = r[i]
      if (r[i] > x1) x1 = r[i]
      if (r[i + 1] < y0) y0 = r[i + 1]
      if (r[i + 1] > y1) y1 = r[i + 1]
    }
  }
  return { x0, y0, x1, y1 }
}

/**
 * 下钻进度 0→1。band 外侧为 0，内侧为 1，中间线性。
 * 上层用它同时驱动：区县层透明度、两套标签的互斥淡入淡出、市界加粗、点击落到哪一层。
 */
export function progress(viewW: number, band: Band | undefined): number {
  if (!band) return 0
  const [hi, lo] = band
  if (viewW >= hi) return 0
  if (viewW <= lo) return 1
  return (hi - viewW) / (hi - lo)
}

/**
 * 标签字号 / 白描边 / 斜纹 pattern 的缩放补偿系数。
 *
 * 这些尺寸都写在用户坐标里，会跟着 viewBox 一起放大 —— 不补偿的话
 * 放大后字会涨成巨人、斜纹粗成色块。乘上这个系数之后就可以按屏幕 px 写尺寸。
 */
export function labelScale(viewW: number, containerPx: number): number {
  // 首帧 clientWidth 可能还是 0，直接除会把 font-size 算成 Infinity，整层标签消失
  if (!containerPx) return 1
  return viewW / containerPx
}

/** 把包围盒装进一个指定宽高比的视窗，留出 k 倍余量 */
export function fitBox(b: BBox, aspect: number, k = 1.2): View {
  const cx = (b.x0 + b.x1) / 2
  const cy = (b.y0 + b.y1) / 2
  const w = Math.max((b.x1 - b.x0) * k, (b.y1 - b.y0) * k * aspect)
  const h = w / aspect
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

/**
 * 下钻到某个单元的目标视窗：保证落进 band 内侧。
 *
 * 呼伦贝尔这种大市，整市装进视窗时视窗宽还在 band 之外，区县永远不出来，
 * 「进入区县层」就成了死按钮。装不下就只看一部分，用户可以拖。
 */
export function drillBox(b: BBox, aspect: number, band: Band | undefined, k = 1.4): View {
  const box = fitBox(b, aspect, k)
  if (!band) return box
  const maxW = band[1] - 8
  if (box.w <= maxW) return box
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const h = maxW / aspect
  return { x: cx - maxW / 2, y: cy - h / 2, w: maxW, h }
}

/** 包围盒是否与视窗（外扩 pad）相交 */
export function intersects(b: BBox, v: View, pad: number): boolean {
  return !(
    b.x1 < v.x - pad ||
    b.x0 > v.x + v.w + pad ||
    b.y1 < v.y - pad ||
    b.y0 > v.y + v.h + pad
  )
}

/** 缩放钳位：最小 6% 基准视窗，最大 1.4 倍 */
export function clampWidth(w: number, baseW: number): number {
  return clamp(w, baseW * 0.05, baseW * 1.4)
}

/** 以 (cx, cy) 为锚点缩放 */
export function zoomAt(v: View, factor: number, cx: number, cy: number, baseW: number): View {
  const w = clampWidth(v.w * factor, baseW)
  const k = w / v.w
  return { x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k, w, h: v.h * k }
}
