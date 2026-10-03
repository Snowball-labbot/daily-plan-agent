export function sessionCookiePolicy(remember: boolean, accessLifetime = 3600) {
  return {
    access: remember ? { maxAge: accessLifetime } : {},
    refresh: remember ? { maxAge: 60 * 60 * 24 * 30 } : {},
    preference: remember ? { maxAge: 60 * 60 * 24 * 30 } : {},
  }
}
