import { prisma } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { fail, handleError } from '@/lib/api'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser()
    const { id } = await params
    const person = await prisma.person.findFirst({
      where: { id, userId: user.id },
      select: { avatarData: true, avatarMime: true },
    })
    if (!person?.avatarData || !person.avatarMime) return fail('没有头像', 404)

    return new Response(Buffer.from(person.avatarData), {
      headers: {
        'content-type': person.avatarMime,
        // 地址带 ?v=updatedAt，换头像会换地址，所以可以长缓存
        'cache-control': 'private, max-age=31536000, immutable',
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
