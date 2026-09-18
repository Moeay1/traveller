'use client'

import { useMemo } from 'react'
import { MapData, MapUnit, ringToPath, shortName, unitToPath } from '@/lib/mapdata'
import { Inset } from '@/lib/regions'

export type CityPaths = { u: MapUnit; d: string }[]

type Props = {
  data: MapData
  inset: Inset
  paths: CityPaths
  lit: Set<number>
  /** adcode → 填充色（单色直接给值，多色给 url(#gradient)） */
  fillOf: (adcode: number) => string | undefined
  /** 当前选中的市 adcode */
  selected: number | null
  /** 下钻进度 0→1，驱动市填色让位、市界加粗、标签淡出 */
  t: number
  /** 下钻到的市，描重一点 */
  focus: number | null
}

/**
 * 市这一层。分三个 g：
 *
 * - `cityFill` 点亮色（下钻时淡出，让位给区县层）
 * - `cityEdge` 底色 + 命中层（区县层之下）
 * - `cityLine` 只描边（区县层之上，见下面注释）
 *
 * 阴影层单独放在外面（`litLayer`），因为它要垫在最底下。
 */
export function CityFillLayers({
  paths,
  lit,
  fillOf,
  selected,
}: Pick<Props, 'paths' | 'lit' | 'fillOf' | 'selected'>) {
  return (
    <>
      {/* 点亮城市的投影托底层。下钻时整层淡出 —— 区县多了以后滤镜是渲染开销第一嫌疑 */}
      <g id="litLayer">
        {paths
          .filter(({ u }) => lit.has(u.a))
          .map(({ u, d }) => (
            <path key={u.a} d={d} style={{ fill: fillOf(u.a) ?? 'var(--lit)' }} filter="url(#soft)" />
          ))}
      </g>

      <g id="cityFill">
        {paths
          .filter(({ u }) => lit.has(u.a))
          .map(({ u, d }) => (
            <path key={u.a} d={d} style={{ fill: fillOf(u.a) }} />
          ))}
      </g>

      {/*
        底色 + 命中层。点亮的市这里是 fill:none，让下面的彩色填充透出来 ——
        但 SVG 里 fill:none 就只有描边能命中，点市会从缝里漏到下面没有
        data-adcode 的填充层上，结果是点亮的城市点不中。所以填充层一律
        pointer-events:none（在 CSS 里），这一层显式 pointer-events:all。
      */}
      <g id="cityEdge">
        {paths.map(({ u, d }) => (
          <path
            key={u.a}
            d={d}
            data-adcode={u.a}
            style={lit.has(u.a) ? { fill: 'none' } : undefined}
            className={`city${lit.has(u.a) ? ' lit' : ''}${selected === u.a ? ' sel' : ''}`}
          />
        ))}
      </g>
    </>
  )
}

/**
 * 市界描边层，必须渲染在区县层**之上**。
 *
 * 放在下面会被区县的填色直接糊掉，下钻后完全看不出市的边界在哪。
 * 这一层同时承担「市界在下钻时加粗、升级成分组线」的视觉职责，只描边、不接事件。
 */
export function CityLineLayer({ paths, focus }: Pick<Props, 'paths' | 'focus'>) {
  return (
    <g id="cityLine">
      {paths.map(({ u, d }) => (
        <path key={u.a} d={d} className={focus === u.a ? 'focus' : undefined} />
      ))}
    </g>
  )
}

export function ProvinceLayer({ data }: Pick<Props, 'data'>) {
  const provPaths = useMemo(() => data.pv.map(ringToPath), [data])
  return (
    <g id="pvLayer">
      {provPaths.map((d, i) => (
        <path key={i} d={d} className="prov" />
      ))}
    </g>
  )
}

export function CityLabelLayer({ paths, lit }: Pick<Props, 'paths' | 'lit'>) {
  return (
    <g id="cityLbl">
      {paths
        .filter(({ u }) => lit.has(u.a))
        .map(({ u }) => (
          <text key={u.a} x={u.c[0]} y={u.c[1] - 6} className="lbl">
            {shortName(u.n)}
          </text>
        ))}
    </g>
  )
}

/** 离主体太远、单独画成小图的部分（中国是南海诸岛，日本是冲绳） */
export function InsetMap({
  data,
  inset,
  lit,
  fillOf,
  selected,
}: Pick<Props, 'data' | 'inset' | 'lit' | 'fillOf' | 'selected'>) {
  const jdPaths = useMemo(() => data.jd.map((l) => ringToPath(l).replace(/Z$/, '')), [data])
  const insetUnits = useMemo(
    () => data.u.filter((u) => inset.units.includes(u.n)),
    [data, inset],
  )

  return (
    <div id="inset" style={{ width: inset.size.w, height: inset.size.h }}>
      <svg viewBox={inset.viewBox} aria-hidden="true">
        {inset.nineDash && jdPaths.map((d, i) => <path key={i} d={d} className="jd" />)}
        {insetUnits.map((u) => (
          <path
            key={u.a}
            d={unitToPath(u)}
            data-adcode={u.a}
            style={lit.has(u.a) ? { fill: fillOf(u.a) } : undefined}
            className={`city${lit.has(u.a) ? ' lit' : ''}${selected === u.a ? ' sel' : ''}`}
          />
        ))}
      </svg>
      <span>{inset.label}</span>
    </div>
  )
}
