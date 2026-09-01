import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { visitPatchSchema } from '@/lib/validation'
import { fail, handleError, ok } from '@/lib/api'
import { serializeVisit } from '@/lib/visit'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser()
    const { id } = await params
    const patch = visitPatchSchema.parse(await req.json())

    // 先确认这条记录属于当前用户，别让人改到别人的
    const own = await prisma.visit.findFirst({ where: { id, userId: user.id }, select: { id: true } })
    if (!own) return fail('找不到这条记录', 404)

    if (patch.personIds?.length) {
      const owned = await prisma.person.count({
        where: { id: { in: patch.personIds }, userId: user.id },
      })
      if (owned !== patch.personIds.length) return fail('选中的人物里有找不到的', 404)
    }

    const visit = await prisma.visit.update({
      where: { id },
      data: {
        ...(patch.visitedOn ? { visitedOn: new Date(`${patch.visitedOn}T00:00:00Z`) } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
        // set 是整份替换，正好对应「这次到访就是这些人」的语义
        ...(patch.personIds === undefined
          ? {}
          : { persons: { set: patch.personIds.map((id) => ({ id })) } }),
      },
      include: { persons: true },
    })
    return ok(serializeVisit(visit))
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser()
    const { id } = await params

    const { count } = await prisma.visit.deleteMany({ where: { id, userId: user.id } })
    if (!count) return fail('找不到这条记录', 404)
    return ok({ ok: true })
  } catch (e) {
    return handleError(e)
  }
}
