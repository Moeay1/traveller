import { z } from 'zod'

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email('邮箱格式不对'),
  password: z.string().min(8, '密码至少 8 位').max(200, '密码太长了'),
})

export const visitInputSchema = z.object({
  country: z.enum(['CN', 'JP']).default('CN'),
  adcode: z.number().int().positive(),
  cityName: z.string().min(1),
  province: z.string().min(1),
  visitedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD'),
  note: z.string().max(2000, '备注最多 2000 字').default(''),
  personIds: z.array(z.string().min(1)).max(20, '一次最多选 20 个人').default([]),
})

export const visitPatchSchema = visitInputSchema
  .pick({ visitedOn: true, note: true, personIds: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: '没有要修改的字段' })

/** 客户端已把头像压到 256px 并转成 data URL，这里只收 png / jpeg / webp */
const dataUrlRe = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/

export const personInputSchema = z.object({
  name: z.string().trim().min(1, '姓名不能为空').max(24, '姓名最多 24 个字'),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, '颜色格式应为 #RRGGBB')
    .optional(),
  avatar: z
    .string()
    .regex(dataUrlRe, '头像格式不支持，请换一张图片')
    .max(600_000, '头像太大了')
    .nullish(),
})

export const personPatchSchema = personInputSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: '没有要修改的字段' },
)
