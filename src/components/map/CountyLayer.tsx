'use client'

import { useMemo } from 'react'
import type { LoadedShard } from '@/lib/countyshards'

export type CountySel = { adcode: number; parent: number } | null

type Props = {
  /** 当前视窗内、已加载好的分片 */
  shards: readonly LoadedShard[]
  /** 区县 adcode → 颜色（该区县自己有记录时） */
  countyColors: Map<number, string[]>
  /** 有市级记录、但名下没有任何区县记录的市 —— 它的区县画成斜纹 */
  inheritCities: ReadonlySet<number>
  selected: CountySel
  /** 多色填充的 key 生成，与市层共用同一批 gradient */
  fillOf: (colors: string[]) => string
}

/**
 * 区县这一层。三态（见 spec §6）：
 *
 * - `lit`     该区县自己有记录 → 人物身份色
 * - `inherit` 该区县没记录、但所属市有市级记录 → 斜纹（去过这个市，还没细化到区县）
 * - `blank`   都没有 → 底色
 *
 * `inherit` 是这套设计里唯一的新视觉状态，它一次解决两件事：老的市级记录
 * 不回填也有合理呈现；它自己就是「下一步该记什么」的提示。
 */
export default function CountyLayer({
  shards,
  countyColors,
  inheritCities,
  selected,
  fillOf,
}: Props) {
  /**
   * 按「可见分片 + 选中态 + 配色」做 key 缓存。视窗里的市没变就不重建 DOM ——
   * 这一条是区县层能流畅拖动的关键（原型里验证过）。
   */
  const key = useMemo(
    () =>
      shards.map((s) => s.parent).join(',') +
      '|' +
      (selected ? `${selected.parent}:${selected.adcode}` : '') +
      '|' +
      countyColors.size +
      '|' +
      inheritCities.size,
    [shards, selected, countyColors, inheritCities],
  )

  const shapes = useMemo(() => {
    const out: React.ReactElement[] = []
    for (const shard of shards) {
      const inheritAll = inheritCities.has(shard.parent)
      for (const u of shard.units) {
        const colors = countyColors.get(u.a)
        const isSel = selected?.adcode === u.a
        let cls = 'cty'
        let style: React.CSSProperties | undefined
        if (colors?.length) {
          cls += ' lit'
          style = { fill: fillOf(colors) }
        } else if (inheritAll) {
          cls += ' inherit'
        } else {
          cls += ' blank'
        }
        if (isSel) cls += ' sel'
        out.push(
          <path
            key={u.a}
            d={shard.paths.get(u.a)}
            data-county={u.a}
            data-parent={shard.parent}
            style={style}
            className={cls}
          />,
        )
      }
    }
    return out
    // key 把真正影响渲染的东西都编码进去了，用它做依赖比列一堆对象引用稳
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const labels = useMemo(() => {
    const out: React.ReactElement[] = []
    for (const shard of shards) {
      for (const u of shard.units) {
        // 只标已点亮的，跟市层同一条规则 —— 否则区县层标签会糊成一团
        if (!countyColors.get(u.a)?.length) continue
        out.push(
          <text key={u.a} x={u.c[0]} y={u.c[1] - 4} className="lbl">
            {u.n}
          </text>,
        )
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return (
    <>
      <g id="countyLayer">{shapes}</g>
      <g id="countyLbl">{labels}</g>
    </>
  )
}
