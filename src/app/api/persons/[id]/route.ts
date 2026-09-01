import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { personPatchSchema } from '@/lib/validation'
import { fail, handleError, ok } from '@/lib/api'
import { serializePerson } from '@/lib/person'
import { decodeAvatar } from '@/lib/avatar'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const user = await requireUser()
    const { id } = await params
    const patch = personPatchSchema.parse(await req.json())

    const own = await prisma.person.findFirst({ where: { id, userId: user.id }, select: { id: true } })
    if (!own) return fail('找不到这个人物', 404)

    if (patch.name) {
      const dup = await prisma.person.findFirst({
        where: { userId: user.id, name: patch.name, NOT: { id } },
        select: { id: true },
      })
      if (dup) return fail(`已经有一个叫「${patch.name}」的人了`, 409)
    }

    // avatar 显式传 null 表示清掉头像，不传则保持原样
    const img = patch.avatar ? decodeAvatar(patch.avatar) : null
    const person = await prisma.person.update({
      where: { id },
      data: {
        ...(patch.name ? { name: patch.name } : {}),
        ...(patch.color ? { color: patch.color } : {}),
        ...(patch.avatar === undefined
          ? {}
          : patch.avatar === null
            ? { avatarData: null, avatarMime: null }
            : { avatarData: img!.data, avatarMime: img!.mime }),
      },
    })
    return ok(serializePerson(person))
  } catch (e) {
    return handleError(e)
  }
}

/** 删人物。他名下的到访记录保留，personId 置空（schema 里是 SetNull）。 */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser()
    const { id } = await params
    const { count } = await prisma.person.deleteMany({ where: { id, userId: user.id } })
    if (!count) return fail('找不到这个人物', 404)
    return ok({ ok: true })
  } catch (e) {
    return handleError(e)
  }
}
