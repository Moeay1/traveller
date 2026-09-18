import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { visitInputSchema } from '@/lib/validation'
import { fail, handleError, ok } from '@/lib/api'
import { serializeVisit } from '@/lib/visit'
import { parentOfCounty } from '@/lib/counties'

/** 当前用户的全部足迹，按日期倒序。 */
export async function GET() {
  try {
    const user = await requireUser()
    const visits = await prisma.visit.findMany({
      where: { userId: user.id },
      orderBy: [{ visitedOn: 'desc' }, { createdAt: 'desc' }],
      include: { persons: true },
    })
    return ok({ visits: visits.map(serializeVisit) })
  } catch (e) {
    return handleError(e)
  }
}

/** 新增一次到访。同一座城市可以记录多次。 */
export async function POST(req: Request) {
  try {
    const user = await requireUser()
    const input = visitInputSchema.parse(await req.json())

    // 选了人就先确认这些人都是当前用户的
    if (input.personIds.length) {
      const owned = await prisma.person.count({
        where: { id: { in: input.personIds }, userId: user.id },
      })
      if (owned !== input.personIds.length) return fail('选中的人物里有找不到的', 404)
    }

    // 区县级记录：确认 parentAdcode 真的是这个区县的父级市。
    // 不能靠 adcode 前缀推 —— 四个直辖市在 cn.json 里是整体单元（北京 110000，
    // 而东城区是 110101，前缀推出 110100 这个地图上不存在的码），名录里
    // 有 86 个区县属于这种情况。推错了那座城永远不会被点亮。
    if (input.level === 'county') {
      const parent = await parentOfCounty(input.adcode)
      if (parent === null) return fail('这个区县不在地图数据里', 400)
      if (parent !== input.parentAdcode) {
        return fail(`区县 ${input.adcode} 的父级市应为 ${parent}`, 400)
      }
    }

    const visit = await prisma.visit.create({
      data: {
        userId: user.id,
        country: input.country,
        adcode: input.adcode,
        level: input.level,
        parentAdcode: input.parentAdcode,
        cityName: input.cityName,
        province: input.province,
        visitedOn: new Date(`${input.visitedOn}T00:00:00Z`),
        note: input.note,
        persons: { connect: input.personIds.map((id) => ({ id })) },
      },
      include: { persons: true },
    })
    return ok(serializeVisit(visit), 201)
  } catch (e) {
    return handleError(e)
  }
}

/**
 * 取消点亮某个地图单元：删掉它名下在当前用户名下的全部到访。
 *
 * 传市码 = 连它的区县记录一起删；传区县码 = 只删那个区县。
 * 前者必须把区县记录也扫掉 —— 区县记录的 adcode 是区县码，只按市码删删不到，
 * 而按点亮规则（市有市级记录 或 有任一区县记录即点亮）那座城会留在亮着的状态，
 * 用户点了「取消点亮」却发现它还亮着。
 */
export async function DELETE(req: Request) {
  try {
    const user = await requireUser()
    const params = new URL(req.url).searchParams
    const adcode = Number(params.get('adcode'))
    const country = params.get('country') ?? 'CN'
    if (!Number.isInteger(adcode) || adcode <= 0) return fail('缺少合法的 adcode', 400)

    // 必须带国家：中国的 adcode 是 6 位，日本是 1–47，但别的国家未必不撞
    const { count } = await prisma.visit.deleteMany({
      where: {
        userId: user.id,
        country,
        // 传区县码时 parentAdcode 分支不会命中任何记录（区县没有下级），
        // 所以同一个写法同时覆盖「删整市」和「删单个区县」两种语义
        OR: [{ adcode }, { parentAdcode: adcode }],
      },
    })
    if (!count) return fail('这个地图单元没有记录', 404)
    return ok({ deleted: count })
  } catch (e) {
    return handleError(e)
  }
}
