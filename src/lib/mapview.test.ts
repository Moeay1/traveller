import { describe, expect, it } from 'vitest'
import { bboxOfRings, drillBox, fitBox, intersects, labelScale, progress } from './mapview'

const BASE = { x: -14, y: -14, w: 1028, h: 874 }
const ASPECT = BASE.w / BASE.h
const BAND = [210, 110] as const

describe('progress：下钻进度', () => {
  it('没有 band 的层级恒为 0', () => {
    expect(progress(500, undefined)).toBe(0)
  })

  it('带外为 0，带内线性，带内侧为 1', () => {
    expect(progress(1028, BAND)).toBe(0)
    expect(progress(210, BAND)).toBe(0)
    expect(progress(160, BAND)).toBeCloseTo(0.5, 6)
    expect(progress(110, BAND)).toBe(1)
    expect(progress(40, BAND)).toBe(1)
  })
})

describe('labelScale：抵掉 viewBox 放大', () => {
  it('等于 视窗宽 / 容器像素宽，这样按屏幕 px 写的字号才恒定', () => {
    expect(labelScale(1028, 1028)).toBe(1)
    expect(labelScale(100, 800)).toBeCloseTo(0.125, 9)
  })

  it('容器宽为 0 时不返回 Infinity/NaN', () => {
    // 首帧 clientWidth 可能是 0，直接除会把 font-size 算成 Infinity，
    // 整层标签瞬间消失
    expect(Number.isFinite(labelScale(1028, 0))).toBe(true)
  })
})

describe('fitBox：把包围盒装进视窗', () => {
  const b = { x0: 100, y0: 200, x1: 140, y1: 230 }

  it('保持视窗宽高比', () => {
    const v = fitBox(b, ASPECT)
    expect(v.w / v.h).toBeCloseTo(ASPECT, 6)
  })

  it('居中在包围盒中心', () => {
    const v = fitBox(b, ASPECT)
    expect(v.x + v.w / 2).toBeCloseTo(120, 6)
    expect(v.y + v.h / 2).toBeCloseTo(215, 6)
  })

  it('高瘦的包围盒按高度定宽，不会被裁掉', () => {
    const tall = { x0: 0, y0: 0, x1: 10, y1: 400 }
    const v = fitBox(tall, ASPECT)
    expect(v.h).toBeGreaterThanOrEqual(400)
  })
})

describe('drillBox：下钻目标视窗', () => {
  it('小市正常装进去，并落在带内', () => {
    const v = drillBox({ x0: 490, y0: 670, x1: 515, y1: 692 }, ASPECT, BAND)
    expect(progress(v.w, BAND)).toBe(1)
  })

  it('呼伦贝尔这种大市装不下，也必须钳进带内', () => {
    // 整市装进视窗时视窗宽还在 band 之外，区县永远不出来，
    // 「进入区县层」就变成一个死按钮。装不下就只看一部分，可以拖。
    const huge = { x0: 700, y0: 20, x1: 900, y1: 200 }
    const plain = fitBox(huge, ASPECT)
    expect(progress(plain.w, BAND)).toBe(0) // 直接 fit 的话确实出不来区县
    const v = drillBox(huge, ASPECT, BAND)
    expect(progress(v.w, BAND)).toBe(1)
    // 钳完之后仍然对准原来的中心
    expect(v.x + v.w / 2).toBeCloseTo(800, 6)
    expect(v.y + v.h / 2).toBeCloseTo(110, 6)
  })

  it('没有 band 的国家退回普通 fit（下钻余量 k 更松，所以要对齐 k 比）', () => {
    const b = { x0: 0, y0: 0, x1: 100, y1: 80 }
    expect(drillBox(b, ASPECT, undefined)).toEqual(fitBox(b, ASPECT, 1.4))
  })
})

describe('intersects：视窗内的单元', () => {
  const view = { x: 0, y: 0, w: 100, h: 80 }

  it('相交、包含、被包含都算命中', () => {
    expect(intersects({ x0: 10, y0: 10, x1: 20, y1: 20 }, view, 0)).toBe(true)
    expect(intersects({ x0: -50, y0: -50, x1: 200, y1: 200 }, view, 0)).toBe(true)
    expect(intersects({ x0: 95, y0: 75, x1: 120, y1: 100 }, view, 0)).toBe(true)
  })

  it('完全在外面不命中', () => {
    expect(intersects({ x0: 200, y0: 0, x1: 210, y1: 10 }, view, 0)).toBe(false)
    expect(intersects({ x0: 0, y0: -50, x1: 10, y1: -40 }, view, 0)).toBe(false)
  })

  it('pad 把边缘外一点的也拉进来（预取用）', () => {
    const justOutside = { x0: 105, y0: 10, x1: 110, y1: 20 }
    expect(intersects(justOutside, view, 0)).toBe(false)
    expect(intersects(justOutside, view, 20)).toBe(true)
  })
})

describe('bboxOfRings：扁平坐标环的包围盒', () => {
  it('跨多个环取并集', () => {
    expect(bboxOfRings([[0, 0, 2, 0, 2, 2], [10, 10, 11, 12]])).toEqual({
      x0: 0, y0: 0, x1: 11, y1: 12,
    })
  })
})
