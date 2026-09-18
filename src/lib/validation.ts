import { z } from 'zod'

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email('邮箱格式不对'),
  password: z.string().min(8, '密码至少 8 位').max(200, '密码太长了'),
})

/** 字段本体。superRefine 之后拿不到 .pick()，所以 patch 从这里派生 */
const visitFields = z.object({
    country: z.enum(['CN', 'JP']).default('CN'),
    /** 记录所在地图单元的代码。是市码还是区县码由 level 决定 */
    adcode: z.number().int().positive(),
    level: z.enum(['city', 'county']).default('city'),
    /** 区县级记录的父级市 adcode；市级记录必须为空 */
    parentAdcode: z.number().int().positive().nullish().transform((v) => v ?? null),
    /** 区县级记录这里存区县名 */
    cityName: z.string().min(1),
    province: z.string().min(1),
    visitedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD'),
    note: z.string().max(2000, '备注最多 2000 字').default(''),
  personIds: z.array(z.string().min(1)).max(20, '一次最多选 20 个人').default([]),
})

export const visitInputSchema = visitFields.superRefine((v, ctx) => {
    const at = (message: string, path: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] })

    if (v.level === 'county') {
      // 没有父级市就没法把这条记录聚合回全国层，那座城不会亮
      if (v.parentAdcode === null) return at('区县级记录必须带父级市 adcode', 'parentAdcode')
      // 前端如果把市码当区县码传进来，会得到一条谁都不属于的记录
      if (v.parentAdcode === v.adcode) {
        return at('父级市 adcode 不能等于区县自己的 adcode', 'parentAdcode')
      }
      if (v.country !== 'CN') return at('目前只有中国有区县这一层', 'level')
    } else if (v.parentAdcode !== null) {
      at('市级记录不该带 parentAdcode', 'parentAdcode')
    }
  })

// 不允许 patch 改 level / adcode：改粒度等于换一条记录，让调用方删了重建
export const visitPatchSchema = visitFields
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
