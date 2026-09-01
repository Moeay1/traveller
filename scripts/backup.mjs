/**
 * 导出全部数据到一个 JSON 文件。
 *
 *   npm run db:backup                     # 存到 ./backups/
 *   BACKUP_DIR=~/Documents npm run db:backup
 *
 * 用 JSON 而不是 pg_dump：可读、可 diff、跟数据库版本解耦，
 * 将来换 SQLite 或换机器也能导回去。头像转成 base64 一并带走。
 */
import { PrismaClient } from '@prisma/client'
import { mkdirSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const KEEP = 30 // 保留最近多少份
const prisma = new PrismaClient()

const expand = (p) => (p.startsWith('~') ? join(homedir(), p.slice(1)) : p)
const dir = resolve(expand(process.env.BACKUP_DIR ?? 'backups'))
mkdirSync(dir, { recursive: true })

const [users, persons, visits] = await Promise.all([
  prisma.user.findMany(),
  prisma.person.findMany({ orderBy: { createdAt: 'asc' } }),
  prisma.visit.findMany({ orderBy: { visitedOn: 'asc' }, include: { persons: { select: { id: true } } } }),
])

const payload = {
  format: 'traveller-backup',
  version: 1,
  exportedAt: new Date().toISOString(),
  counts: { users: users.length, persons: persons.length, visits: visits.length },
  users: users.map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    // scrypt 派生值，不是明文；带上才能原样恢复登录
    passwordHash: u.passwordHash,
    createdAt: u.createdAt.toISOString(),
  })),
  persons: persons.map((p) => ({
    id: p.id,
    userId: p.userId,
    name: p.name,
    color: p.color,
    avatarMime: p.avatarMime,
    avatarBase64: p.avatarData ? Buffer.from(p.avatarData).toString('base64') : null,
    createdAt: p.createdAt.toISOString(),
  })),
  visits: visits.map((v) => ({
    id: v.id,
    userId: v.userId,
    adcode: v.adcode,
    cityName: v.cityName,
    province: v.province,
    visitedOn: v.visitedOn.toISOString().slice(0, 10),
    note: v.note,
    personIds: v.persons.map((p) => p.id),
    createdAt: v.createdAt.toISOString(),
  })),
}

const d = new Date()
const pad = (n) => String(n).padStart(2, '0')
const name = `traveller-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`
const file = join(dir, name)
writeFileSync(file, JSON.stringify(payload, null, 2))

const kb = (statSync(file).size / 1024).toFixed(1)
console.log(`✔ ${payload.counts.visits} 条到访 · ${payload.counts.persons} 个人物 · ${payload.counts.users} 个账号`)
console.log(`  → ${file}  (${kb} KB)`)

// 轮转：只留最近 KEEP 份
const olds = readdirSync(dir)
  .filter((f) => /^traveller-\d{8}-\d{4}\.json$/.test(f))
  .sort()
  .slice(0, -KEEP)
for (const f of olds) unlinkSync(join(dir, f))
if (olds.length) console.log(`  清理 ${olds.length} 份旧备份，保留最近 ${KEEP} 份`)

await prisma.$disconnect()
