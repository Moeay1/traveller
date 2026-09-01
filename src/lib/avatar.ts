/**
 * 把客户端传来的 data URL 拆成字节和 MIME。格式已由 zod 校验过。
 *
 * 用 Uint8Array.from 而不是直接给 Buffer：Buffer 落在 Node 的共享内存池上，
 * 类型是 Uint8Array<ArrayBufferLike>，而 Prisma 的 Bytes 字段要 Uint8Array<ArrayBuffer>。
 * from 会拷进一块独立的 ArrayBuffer，类型和所有权都干净。
 */
export function decodeAvatar(dataUrl: string): { data: Uint8Array<ArrayBuffer>; mime: string } {
  const [head, b64] = dataUrl.split(',')
  const mime = head.slice('data:'.length, head.indexOf(';'))
  return { data: Uint8Array.from(Buffer.from(b64, 'base64')), mime }
}
