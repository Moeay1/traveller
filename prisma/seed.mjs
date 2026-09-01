/**
 * 预置账号。跑法：npm run db:seed
 * 已存在就只更新密码和昵称，不会重复建号，也不会动已有的足迹。
 *
 * 想顺便灌一批示例足迹：SEED_DEMO=1 npm run db:seed
 */
import { PrismaClient } from '@prisma/client'
import { randomBytes, scrypt as scryptCb } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb)
const prisma = new PrismaClient()

const EMAIL = process.env.SEED_EMAIL ?? 'me@traveller.local'
const PASSWORD = process.env.SEED_PASSWORD ?? 'traveller'
const NAME = process.env.SEED_NAME ?? '旅人'

// 与 src/lib/auth.ts 的 hashPassword 保持一致：scrypt(N=默认) → `salt:hash`
async function hashPassword(password) {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, 64)
  return `${salt.toString('hex')}:${key.toString('hex')}`
}

const DEMO = [
  [110000, '北京市', '北京市', '2019-04-12', '第一次看故宫的雪化完，护城河边的柳树刚发芽。'],
  [310000, '上海市', '上海市', '2021-10-02', '外滩人挤人，最后是在武康路的小咖啡馆坐了一下午。'],
  [330100, '杭州市', '浙江省', '2022-03-28', '西湖边骑车环了一圈，龙井村喝了新茶。'],
  [440300, '深圳市', '广东省', '2023-06-15', '出差顺路，晚上去了海上世界。'],
  [510100, '成都市', '四川省', '2023-09-08', '宽窄巷子太挤，但玉林路的串串是真的好吃。'],
  [530100, '昆明市', '云南省', '2024-01-20', '从昆明中转去大理，翠湖的海鸥比想象中多。'],
  [532900, '大理白族自治州', '云南省', '2024-01-22', '洱海边住了两晚，早上六点起来看日出。'],
  [620900, '酒泉市', '甘肃省', '2024-05-01', '敦煌莫高窟，讲解员说的第 220 窟记了很久。'],
  [150200, '包头市', '内蒙古自治区', '2024-10-03', '包头出发去希拉穆仁草原，夜里能看到银河。'],
  [350100, '福州市', '福建省', '2025-04-19', '鼓浪屿其实是厦门，三坊七巷才是福州。这次是后者。'],
  [420100, '武汉市', '湖北省', '2025-07-11', '东湖绿道骑行 20 公里，热到怀疑人生。'],
]

async function main() {
  const passwordHash = await hashPassword(PASSWORD)
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { passwordHash, displayName: NAME },
    create: { email: EMAIL, passwordHash, displayName: NAME },
    select: { id: true, email: true, displayName: true },
  })

  console.log(`✔ 账号就绪：${user.email} / ${PASSWORD}（昵称 ${user.displayName}）`)

  if (process.env.SEED_DEMO === '1') {
    const existing = await prisma.visit.count({ where: { userId: user.id } })
    if (existing) {
      console.log(`… 已有 ${existing} 条足迹，跳过示例数据`)
    } else {
      await prisma.visit.createMany({
        data: DEMO.map(([adcode, cityName, province, visitedOn, note]) => ({
          userId: user.id,
          adcode,
          cityName,
          province,
          visitedOn: new Date(`${visitedOn}T00:00:00Z`),
          note,
        })),
      })
      console.log(`✔ 灌入 ${DEMO.length} 条示例足迹`)
    }
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
