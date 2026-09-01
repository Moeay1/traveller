import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { visitInputSchema } from '@/lib/validation'
import { fail, handleError, ok } from '@/lib/api'
import { serializeVisit } from '@/lib/visit'

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

    const visit = await prisma.visit.create({
      data: {
        userId: user.id,
        country: input.country,
        adcode: input.adcode,
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

/** 取消点亮：删掉某座城市在当前用户名下的全部到访。 */
export async function DELETE(req: Request) {
  try {
    const user = await requireUser()
    const params = new URL(req.url).searchParams
    const adcode = Number(params.get('adcode'))
    const country = params.get('country') ?? 'CN'
    if (!Number.isInteger(adcode) || adcode <= 0) return fail('缺少合法的 adcode', 400)

    // 必须带国家：中国的 adcode 是 6 位，日本是 1–47，但别的国家未必不撞
    const { count } = await prisma.visit.deleteMany({ where: { userId: user.id, country, adcode } })
    if (!count) return fail('这座城市没有记录', 404)
    return ok({ deleted: count })
  } catch (e) {
    return handleError(e)
  }
}
