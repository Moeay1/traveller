import { prisma } from '@/lib/db'
import { createSession, verifyPassword } from '@/lib/auth'
import { credentialsSchema } from '@/lib/validation'
import { fail, handleError, ok } from '@/lib/api'

export async function POST(req: Request) {
  try {
    const { email, password } = credentialsSchema.parse(await req.json())
    const user = await prisma.user.findUnique({ where: { email } })

    // 邮箱不存在和密码错误返回同一句话，避免暴露哪些邮箱注册过
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return fail('邮箱或密码不对', 401)
    }

    await createSession(user.id)
    return ok({ id: user.id, email: user.email, displayName: user.displayName })
  } catch (e) {
    return handleError(e)
  }
}
