import test from 'node:test'
import assert from 'node:assert/strict'
import { sessionCookiePolicy } from '../apps/web/lib/session-policy.ts'

test('remembered logins persist while unchecked logins use session cookies',()=>{
  const remembered=sessionCookiePolicy(true,1800)
  assert.equal(remembered.access.maxAge,1800)
  assert.equal(remembered.refresh.maxAge,2592000)
  assert.equal(remembered.preference.maxAge,2592000)
  const temporary=sessionCookiePolicy(false)
  for(const options of Object.values(temporary))assert.equal('maxAge' in options,false)
})
