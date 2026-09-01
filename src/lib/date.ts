export const pad = (n: number) => String(n).padStart(2, '0')

export const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`

export function today(): string {
  const d = new Date()
  return ymd(d.getFullYear(), d.getMonth(), d.getDate())
}

/** 只按日期比较，避开时区。 */
export function stamp(dateStr: string): number {
  return Date.parse(`${dateStr}T00:00:00Z`)
}

export function formatStamp(ts: number): string {
  const d = new Date(ts)
  return ymd(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** "今天" / "12 天前" / "3 个月前" / "1.4 年前" */
export function daysAgo(dateStr: string): string {
  const n = Math.floor((Date.now() - stamp(dateStr)) / 864e5)
  if (n < 0) return '还没到'
  if (n === 0) return '今天'
  if (n < 30) return `${n} 天前`
  if (n < 365) return `${Math.floor(n / 30)} 个月前`
  return `${(n / 365).toFixed(1)} 年前`
}
