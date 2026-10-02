import test from 'node:test'
import assert from 'node:assert/strict'
import { checkOrigin } from '../apps/web/lib/auth.ts'

test('same-origin browser requests work behind Next while cross-origin writes fail',()=>{
  assert.doesNotThrow(()=>checkOrigin(new Request('http://localhost:3001/api/auth',{headers:{host:'127.0.0.1:3001',origin:'http://127.0.0.1:3001'}})))
  assert.doesNotThrow(()=>checkOrigin(new Request('http://localhost/api/rpc',{headers:{host:'planner.example',origin:'https://planner.example','x-forwarded-proto':'https'}})))
  assert.throws(()=>checkOrigin(new Request('https://planner.example/api/rpc',{headers:{host:'planner.example',origin:'https://attacker.example'}})),/来源不匹配/)
  assert.throws(()=>checkOrigin(new Request('https://planner.example/api/rpc',{headers:{cookie:'planner_access=test-only'}})),/缺少请求来源/)
  assert.doesNotThrow(()=>checkOrigin(new Request('https://planner.example/api/rpc',{headers:{authorization:'Bearer test-only'}})))
})
