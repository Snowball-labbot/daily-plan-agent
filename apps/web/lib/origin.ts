/** Validate the public destination without importing account or generated engine code. */
export function checkOrigin(request: Request) {
  const origin=request.headers.get('origin')
  // Next may normalize request.url to its internal localhost address.
  if(origin) {
    const supplied=new URL(origin)
    const expected=(request.headers.get('host') ?? new URL(request.url).host).toLowerCase()
    const protocol=request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? new URL(request.url).protocol.replace(':','')
    if(supplied.host.toLowerCase()!==expected || supplied.protocol!==`${protocol}:`)throw Object.assign(new Error('请求来源不匹配'),{status:403})
  }
  if(!origin && request.headers.has('cookie') && !request.headers.has('authorization'))throw Object.assign(new Error('缺少请求来源'),{status:403})
}
