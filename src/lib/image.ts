/** 头像最长边压到这个尺寸再上传，够清晰又不至于把库撑大 */
const MAX_EDGE = 256

/**
 * 读取用户选的图片，等比缩放并居中裁成正方形，输出 data URL。
 * 在浏览器里做，服务端只存结果。
 */
export async function fileToSquareDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const edge = Math.min(side, MAX_EDGE)

  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = edge
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持处理图片')

  // 居中裁剪：从原图中间取一个正方形
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, edge, edge)
  bitmap.close()

  // PNG 可能很大，统一转 JPEG；有透明通道的图会被填成黑底，所以先铺白
  const out = document.createElement('canvas')
  out.width = out.height = edge
  const octx = out.getContext('2d')!
  octx.fillStyle = '#fff'
  octx.fillRect(0, 0, edge, edge)
  octx.drawImage(canvas, 0, 0)

  return out.toDataURL('image/jpeg', 0.85)
}
