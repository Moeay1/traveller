import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { personInputSchema } from '@/lib/validation'
import { fail, handleError, ok } from '@/lib/api'
import { pickColor, serializePerson } from '@/lib/person'
import { decodeAvatar } from '@/lib/avatar'

export async function GET() {
  try {
    const user = await requireUser()
    const persons = await prisma.person.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { visits: true } } },
    })
    return ok({ persons: persons.map(serializePerson) })
  } catch (e) {
    return handleError(e)
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser()
    const { name, avatar, color } = personInputSchema.parse(await req.json())

    const dup = await prisma.person.findFirst({ where: { userId: user.id, name }, select: { id: true } })
    if (dup) return fail(`已经有一个叫「${name}」的人了`, 409)

    const img = avatar ? decodeAvatar(avatar) : null
    const person = await prisma.person.create({
      data: {
        userId: user.id,
        name,
        color: color ?? pickColor(name),
        avatarData: img?.data ?? null,
        avatarMime: img?.mime ?? null,
      },
    })
    return ok(serializePerson(person), 201)
  } catch (e) {
    return handleError(e)
  }
}
