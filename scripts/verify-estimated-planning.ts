import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { fixture } from '../tests/helpers/host.ts'
import { DEFAULT_PERIODS } from '../src/seed.ts'

const { chromium } = await import(pathToFileURL(process.argv[2]!).href)
const { service, ctx } = await fixture()
await service.updateSettings({ periods: DEFAULT_PERIODS, dayEndPeriod: 17 })
const text = '下周一大概下午六点和朋友吃饭，晚上可能去喝酒。'
ctx.reply = JSON.stringify({ summary: '先预留聚餐，再暂定喝酒，留出转场时间。', appointments: [
  { date: '2026-10-05', title: '朋友聚餐', category: 'activity', lifeArea: 'relationships', startMinute: 1080, endMinute: null, evidence: '下周一大概下午六点和朋友吃饭' },
  { date: '2026-10-05', title: '可能喝酒', category: 'activity', lifeArea: 'relationships', startMinute: 1215, endMinute: null, evidence: '晚上可能去喝酒' },
], gymAdvice: '没有新增训练成绩，保持已有计划。', questions: ['「朋友聚餐」预计持续到几点？'] })
const client = await build({ entryPoints: ['scripts/workflow-preview-client.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic' })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.exposeFunction('isolatedRpc', async (endpoint: string, payload: unknown) => ctx.rpc(endpoint, payload, new AbortController().signal))
  const html = `<html><head><meta charset="utf-8"><style>body{margin:0;font-family:system-ui;color:#242424}</style></head><body><div id="root"></div><script>window.fetch=async(_url,options)=>{const data=JSON.parse(options.body);return new Response(JSON.stringify(await window.isolatedRpc(data.endpoint,data.payload)),{headers:{'Content-Type':'application/json'}})};</script><script>${client.outputFiles[0]!.text}</script></body></html>`
  await page.setContent(html)
  await page.locator('#dp-review-trigger').click()
  await page.getByRole('button', { name: '展望', exact: true }).click()
  await page.getByLabel('展望范围').selectOption('nextWeek')
  await page.getByLabel('描述目标、偏好或临时变化').fill(text)
  const anchor = await page.locator('.dp-coach-drawer').getByRole('button', { name: '整理并安排', exact: true }).boundingBox()
  const inputBox = await page.getByLabel('描述目标、偏好或临时变化').boundingBox()
  await page.getByRole('button', { name: '先看安排', exact: true }).click()
  await page.getByLabel('活动 1结束时间').waitFor()
  assert.equal(await page.getByLabel('活动 1结束时间').inputValue(), '20:00')
  assert.equal(await page.getByLabel('活动 2结束时间').inputValue(), '21:45')
  assert.doesNotMatch(await page.locator('.dp-coach-drawer').innerText(), /暂定/)
  assert(await page.getByLabel('描述目标、偏好或临时变化').isVisible())
  assert.deepEqual(await page.locator('.dp-coach-drawer').getByRole('button', { name: '整理并安排', exact: true }).boundingBox(), anchor)
  assert.deepEqual(await page.getByLabel('描述目标、偏好或临时变化').boundingBox(), inputBox)
  await mkdir('output/playwright', { recursive: true })
  await page.screenshot({ path: 'output/playwright/agnes-estimated-preview.png' })
  await page.getByRole('button', { name: '应用安排', exact: true }).click()
  await page.getByRole('button', { name: '保存修改', exact: true }).waitFor()
  assert(await page.getByLabel('描述目标、偏好或临时变化').isVisible())
  assert.equal(await page.getByLabel('描述目标、偏好或临时变化').inputValue(), '')
  assert(await page.getByRole('button', { name: '展望', exact: true }).isVisible())
  assert.equal(await page.getByLabel('活动 1开始时间').inputValue(), '18:00')
  assert.doesNotMatch(await page.locator('.dp-coach-drawer').innerText(), /暂定/)
  assert.deepEqual(await page.locator('.dp-coach-drawer').getByRole('button', { name: '整理并安排', exact: true }).boundingBox(), anchor)
  assert.deepEqual(await page.getByLabel('描述目标、偏好或临时变化').boundingBox(), inputBox)
  await page.getByLabel('活动 1开始时间').fill('18:30')
  await page.getByLabel('活动 1备注').fill('校门口见')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await page.getByRole('button', { name: '保存修改', exact: true }).isDisabled()
  await page.waitForFunction(() => document.querySelector('.dp-agent-plan-head>span')?.textContent === '已保存')
  assert.equal(ctx.prompts.length, 1)
  assert.deepEqual(await page.locator('.dp-coach-drawer').getByRole('button', { name: '整理并安排', exact: true }).boundingBox(), anchor)
  assert.equal(service.dayPlan('2026-10-05').blocks.find(block => block.title === '朋友聚餐')?.startMinute, 1110)
  assert.equal(await page.locator('.dp-error').count(), 0)
  await page.screenshot({ path: 'output/playwright/agnes-estimated-applied.png' })
  // Reload while the shell is still on the current week: the next-week run and
  // actual future plans must restore together, with no extra model request.
  await page.goto('about:blank'); await page.setContent(html)
  await page.locator('#dp-review-trigger').click()
  await page.getByRole('button', { name: '保存修改', exact: true }).waitFor()
  assert.equal(await page.getByLabel('活动 2名称').inputValue(), '可能喝酒')
  assert.equal(await page.getByLabel('活动 1开始时间').inputValue(), '18:30')
  assert(await page.getByLabel('描述目标、偏好或临时变化').isVisible())
  assert.equal(ctx.prompts.length, 1)
  const newText = '下周一聚餐改成六点半开始，喝酒改到八点四十五。'
  ctx.reply = JSON.stringify({ summary: '按新描述调整两个活动。', appointments: [
    { date: '2026-10-05', title: '朋友聚餐', category: 'activity', startMinute: 1110, endMinute: 1215, evidence: '下周一聚餐改成六点半开始' },
    { date: '2026-10-05', title: '可能喝酒', category: 'activity', startMinute: 1245, endMinute: 1335, evidence: '喝酒改到八点四十五' },
  ] })
  await page.getByLabel('描述目标、偏好或临时变化').fill(newText)
  await page.locator('.dp-coach-drawer').getByRole('button', { name: '整理并安排', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.dp-agent-plan-head>span')?.textContent === '已保存')
  assert.equal(await page.getByLabel('活动 1结束时间').inputValue(), '20:15')
  assert.equal(ctx.prompts.length, 2)
  const active = service.dayPlan('2026-10-05').blocks.filter((block) => block.disposition !== 'deferred')
  assert.equal(active.filter((block) => block.title === '朋友聚餐').length, 1)
  assert.equal(active.filter((block) => block.title === '可能喝酒').length, 1)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'output/playwright/agnes-workspace-mobile.png' })
  assert((await page.locator('.dp-coach-drawer').boundingBox())!.width <= 390)
  assert(await page.locator('.dp-coach-drawer').getByRole('button', { name: '整理并安排', exact: true }).isVisible())
  // A long proposal scrolls inside the plan pane; it cannot push the composer
  // or footer out of the dialog, as the old result screen did.
  await page.setViewportSize({ width: 1280, height: 800 })
  const footerBefore = await page.locator('.dp-agent-workspace-actions').boundingBox()
  const inputBefore = await page.getByLabel('描述目标、偏好或临时变化').boundingBox()
  const manyText = '下周一安排八个活动，每个半小时'
  ctx.reply = JSON.stringify({ summary: '安排八个活动', appointments: Array.from({ length: 8 }, (_, index) => ({ date: '2026-10-05', title: `活动${index + 1}`, category: 'activity', startMinute: 480 + index * 60, endMinute: 510 + index * 60, evidence: manyText })) })
  await page.getByLabel('描述目标、偏好或临时变化').fill(manyText)
  await page.getByRole('button', { name: '先看安排', exact: true }).click()
  await page.getByLabel('活动 8名称').waitFor()
  assert.deepEqual(await page.locator('.dp-agent-workspace-actions').boundingBox(), footerBefore)
  assert.deepEqual(await page.getByLabel('描述目标、偏好或临时变化').boundingBox(), inputBefore)
  assert(await page.locator('.dp-agent-plan-scroll').evaluate((node) => node.scrollHeight > node.clientHeight))
  await page.screenshot({ path: 'output/playwright/agnes-workspace-long-proposal.png' })
  assert.equal(ctx.prompts.length, 3)
  console.log('Stable workspace passed: null end, advice string, ordinary time display, fixed composer and footer positions, direct saved-event editing, cross-week reload, follow-up replacement. Three simulated AI calls including a long proposal, no live storage edits.')
} finally { await browser.close() }
