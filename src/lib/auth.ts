import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import { prisma } from './db'

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

const COOKIE = 'traveller_session'
const MAX_AGE = 60 * 60 * 24 * 30 // 30 天

function secret() {
  const s = process.env.AUTH_SECRET
  if (!s || s.length < 32) {
    throw new Error('AUTH_SECRET 未配置或不足 32 字符，检查 .env')
  }
  return new TextEncoder().encode(s)
}

/* ---------------- 密码 ---------------- */

/** scrypt 派生，输出 `salt:hash`，两段都是 hex。用 node 内置实现，不引第三方依赖。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, 64)
  return `${salt.toString('hex')}:${key.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':')
  if (!saltHex || !keyHex) return false
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), 64)
  const expected = Buffer.from(keyHex, 'hex')
  // 长度不等时 timingSafeEqual 会抛，先挡一道
  if (key.length !== expected.length) return false
  return timingSafeEqual(key, expected)
}

/* ---------------- 会话 ---------------- */

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret())

  const jar = await cookies()
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  })
}

export async function destroySession() {
  const jar = await cookies()
  jar.delete(COOKIE)
}

/** 当前登录用户，未登录返回 null。 */
export async function currentUser() {
  const jar = await cookies()
  const token = jar.get(COOKIE)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret())
    const id = payload.sub
    if (typeof id !== 'string') return null
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, displayName: true },
    })
    return user
  } catch {
    return null // 过期或被篡改
  }
}

/** 给 API 路由用：拿不到用户就抛，由调用方转成 401。 */
export async function requireUser() {
  const user = await currentUser()
  if (!user) throw new UnauthorizedError()
  return user
}

export class UnauthorizedError extends Error {
  constructor() {
    super('未登录')
    this.name = 'UnauthorizedError'
  }
}
