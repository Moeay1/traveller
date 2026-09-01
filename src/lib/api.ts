import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { UnauthorizedError } from './auth'

export function ok<T>(data: T, init?: number) {
  return NextResponse.json(data, { status: init ?? 200 })
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ message }, { status })
}

/** 把路由里抛出的异常统一翻译成响应，避免每个 handler 各写一套 try/catch。 */
export function handleError(e: unknown) {
  if (e instanceof UnauthorizedError) return fail('请先登录', 401)
  if (e instanceof ZodError) return fail(e.issues[0]?.message ?? '参数不合法', 422)
  console.error(e)
  return fail('服务器出错了，稍后再试', 500)
}
