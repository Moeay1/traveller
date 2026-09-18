import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    // 只测纯逻辑：校验规则、区县名录查表、聚合语义。
    // 组件和接口不做快照测试 —— 这套东西的正确性主要落在这些纯函数上。
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
