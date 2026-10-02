export async function runAgnesJson(ctx: any, options: any, turns: any): Promise<any> {
  if (!ctx.modelGateway) return { ok: false, code: 'not-configured', message: '云端 Agnes 尚未配置。请在服务器设置 API 密钥。' }
  return ctx.modelGateway(options, turns)
}
