/**
 * 从备份文件恢复。会先清空目标库的 User / Person / Visit 再导入。
 *
 *   node --env-file=.env scripts/restore.mjs backups/traveller-xxx.json --yes
 *
 * 不加 --yes 只做演练：读文件、报告将写入什么，不动数据库。
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'

const [file, ...flags] = process.argv.slice(2)
if (!file) {
  console.error('用法: node --env-file=.env scripts/restore.mjs <备份文件> [--yes]')
  process.exit(1)
}
const confirmed = flags.includes('--yes')
const data = JSON.parse(readFileSync(file, 'utf8'))
if (data.format !== 'traveller-backup') {
  console.error('这不像是本项目的备份文件')
  process.exit(1)
}

const prisma = new PrismaClient()
const current = {
  users: await prisma.user.count(),
  persons: await prisma.person.count(),
  visits: await prisma.visit.count(),
}

console.log(`备份文件: ${file}`)
console.log(`  导出于 ${data.exportedAt}`)
console.log(`  含 ${data.counts.users} 账号 · ${data.counts.persons} 人物 · ${data.counts.visits} 到访`)
console.log(`目标库现有: ${current.users} 账号 · ${current.persons} 人物 · ${current.visits} 到访`)

if (!confirmed) {
  console.log('\n这是演练，没有写入任何数据。确认无误后加 --yes 重新执行。')
  await prisma.$disconnect()
  process.exit(0)
}

// 顺序要紧：Visit 依赖 Person 和 User
await prisma.visit.deleteMany({})
await prisma.person.deleteMany({})
await prisma.user.deleteMany({})

for (const u of data.users) {
  await prisma.user.create({
    data: { id: u.id, email: u.email, displayName: u.displayName, passwordHash: u.passwordHash, createdAt: new Date(u.createdAt) },
  })
}
for (const p of data.persons) {
  await prisma.person.create({
    data: {
      id: p.id, userId: p.userId, name: p.name, color: p.color,
      avatarMime: p.avatarMime,
      avatarData: p.avatarBase64 ? Uint8Array.from(Buffer.from(p.avatarBase64, 'base64')) : null,
      createdAt: new Date(p.createdAt),
    },
  })
}
for (const v of data.visits) {
  await prisma.visit.create({
    data: {
      id: v.id, userId: v.userId, adcode: v.adcode, cityName: v.cityName, province: v.province,
      visitedOn: new Date(`${v.visitedOn}T00:00:00Z`), note: v.note,
      createdAt: new Date(v.createdAt),
      persons: { connect: v.personIds.map((id) => ({ id })) },
    },
  })
}

const after = {
  users: await prisma.user.count(),
  persons: await prisma.person.count(),
  visits: await prisma.visit.count(),
}
console.log(`\n✔ 恢复完成: ${after.users} 账号 · ${after.persons} 人物 · ${after.visits} 到访`)
await prisma.$disconnect()
