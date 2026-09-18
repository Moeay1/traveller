import type { BBox } from './mapview'
import { bboxOfRings } from './mapview'

/**
 * 区县分片的浏览器端加载与缓存。
 *
 * 分片按父级市切（`/data/cn/530100.json`），进入下钻带时按可见市取。
 * 实测中位 7.2KB、最大 39.3KB，所以不做全屏 loading —— 下钻是个连续动作，
 * 遮罩会把它打断。取不到的市保持市级样态，不报错。
 */

/** 分片里的一个区县，字段名与 MapUnit 对齐 */
export type CountyUnit = {
  /** 区县名 */ n: string
  /** 区县 adcode */ a: number
  /** 标注锚点 */ c: [number, number]
  /** 多边形环，扁平坐标 */ g: number[][]
}

export type CountyShard = {
  /** 父级市 adcode */ p: number
  u: CountyUnit[]
}

/** 加载后就地算好的派生数据，避免每帧重算 */
export type LoadedShard = {
  parent: number
  units: CountyUnit[]
  /** 每个区县的 SVG path，按 adcode */
  paths: Map<number, string>
}

export type ShardIndex = {
  src: string
  fetchedOn: string
  eps: number
  /** 没有下级区划的单元 —— 前端据此不去请求，也不当成错误 */
  skipped: number[]
  shards: Record<string, { n: number; size: number }>
}

function ringToPath(r: readonly number[]): string {
  let s = `M${r[0]} ${r[1]}`
  for (let i = 2; i < r.length; i += 2) s += `L${r[i]} ${r[i + 1]}`
  return s + 'Z'
}

export function countyPath(u: CountyUnit): string {
  return u.g.map(ringToPath).join('')
}

export function countyBBox(u: CountyUnit): BBox {
  return bboxOfRings(u.g)
}

/**
 * 分片仓库。挂在模块作用域，切国家不清空 —— 回来还能直接用。
 */
export class ShardStore {
  private cache = new Map<number, LoadedShard>()
  private inflight = new Map<number, Promise<LoadedShard | null>>()
  private failed = new Set<number>()
  private skipped = new Set<number>()
  private indexLoaded = false

  constructor(private dir: string, private indexUrl: string) {}

  /** 索引只为拿「没有下级的单元」清单，拿不到也能跑 */
  async loadIndex(): Promise<void> {
    if (this.indexLoaded) return
    this.indexLoaded = true
    try {
      const idx: ShardIndex = await fetch(this.indexUrl).then((r) => r.json())
      for (const a of idx.skipped ?? []) this.skipped.add(a)
    } catch {
      // 索引拿不到就退化成「请求过一次失败才知道没有」，不影响主流程
    }
  }

  get(parent: number): LoadedShard | undefined {
    return this.cache.get(parent)
  }

  /** 这个市确定没有区县（数据源里就没有下级），不该反复请求也不该报错 */
  hasNoCounties(parent: number): boolean {
    return this.skipped.has(parent)
  }

  /** 有没有还在飞的请求，用来决定是否显示那条细进度条 */
  get pending(): number {
    return this.inflight.size
  }

  /**
   * 取一片。已缓存直接返回；正在飞的复用同一个 promise；
   * 失败过的不再重试（避免拖着视窗抖动反复打请求）。
   */
  async load(parent: number): Promise<LoadedShard | null> {
    const hit = this.cache.get(parent)
    if (hit) return hit
    if (this.skipped.has(parent) || this.failed.has(parent)) return null
    const flying = this.inflight.get(parent)
    if (flying) return flying

    const task = fetch(`${this.dir}/${parent}.json`)
      .then(async (r) => {
        if (!r.ok) {
          // 404 说明这个市没有下级分片，记进 skipped，等同索引里那批
          if (r.status === 404) this.skipped.add(parent)
          else this.failed.add(parent)
          return null
        }
        const shard: CountyShard = await r.json()
        const loaded: LoadedShard = {
          parent: shard.p,
          units: shard.u,
          paths: new Map(shard.u.map((u) => [u.a, countyPath(u)])),
        }
        this.cache.set(parent, loaded)
        return loaded
      })
      .catch(() => {
        this.failed.add(parent)
        return null
      })
      .finally(() => {
        this.inflight.delete(parent)
      })

    this.inflight.set(parent, task)
    return task
  }

  /** 批量取，并发上限 6 —— 一次下钻可见的市大概十几个 */
  async loadMany(parents: readonly number[], limit = 6): Promise<void> {
    const todo = parents.filter(
      (p) => !this.cache.has(p) && !this.skipped.has(p) && !this.failed.has(p),
    )
    for (let i = 0; i < todo.length; i += limit) {
      await Promise.all(todo.slice(i, i + limit).map((p) => this.load(p)))
    }
  }
}
