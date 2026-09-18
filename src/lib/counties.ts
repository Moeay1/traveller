import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * 区县名录（服务端）。用来校验一条区县级到访的 parentAdcode 是不是真的对，
 * 以及在服务端取区县名。
 *
 * 为什么必须查表、不能靠 adcode 前缀推：中国的区划码是「省2+市2+县2」，
 * 看着 floor(adcode/100)*100 就是父级市，但四个直辖市不是这样 ——
 * cn.json 把北京当成一个整体单元 110000，而东城区是 110101，
 * 前缀推出来是 110100，地图上根本没有这个单元，那座城永远不会被点亮。
 * 名录里有 86 个区县属于这种情况。
 *
 * 数据来自 public/data/cn/names.json（由 scripts/build-counties.py 生成），
 * 2812 条、112KB，进程内只解析一次。
 */

type CountyEntry = { a: number; n: string; p: number }

let cache: Map<number, CountyEntry> | null = null
let loading: Promise<Map<number, CountyEntry>> | null = null

async function load(): Promise<Map<number, CountyEntry>> {
  if (cache) return cache
  // 并发请求只读一次文件
  if (!loading) {
    loading = readFile(path.join(process.cwd(), 'public/data/cn/names.json'), 'utf8')
      .then((raw) => {
        const list = JSON.parse(raw) as CountyEntry[]
        cache = new Map(list.map((e) => [e.a, e]))
        return cache
      })
      .finally(() => {
        loading = null
      })
  }
  return loading
}

/** 区县 adcode → 父级市 adcode；不在名录里返回 null */
export async function parentOfCounty(adcode: number): Promise<number | null> {
  const m = await load()
  return m.get(adcode)?.p ?? null
}

/** 区县 adcode → 区县名；不在名录里返回 null */
export async function resolveCountyName(adcode: number): Promise<string | null> {
  const m = await load()
  return m.get(adcode)?.n ?? null
}
