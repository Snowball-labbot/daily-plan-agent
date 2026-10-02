import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { fixture } from '../tests/helpers/host.ts'
import { DEFAULT_PERIODS } from '../src/seed.ts'

// Pipe-based, isolated browser verification; no local HTTP server or real AI call.
const { chromium } = await import(pathToFileURL(process.argv[2]!).href)
const { service, ctx } = await fixture()
await service.updateSettings({ periods: DEFAULT_PERIODS, dayEndPeriod: 17 })
await service.upsertBlock('2026-10-02', { title: '旧阅读位置', startPeriod: 14, endPeriod: 15 })
ctx.reply = JSON.stringify({ summary: '安排聚餐与论文', tasks: [{ title: '论文修改', category: 'study', periods: 2, dueDate: '2026-10-05', notBefore: '2026-10-05' }],
  appointments: [{ date: '2026-10-02', title: '朋友聚餐', category: 'activity', lifeArea: 'relationships', startMinute: 1150, endMinute: 1235, evidence: '明天19:10–20:35和朋友聚餐' }] })
const client = await build({ entryPoints: ['scripts/workflow-preview-client.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic' })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.exposeFunction('isolatedRpc', async (endpoint: string, payload: unknown) => ctx.rpc(endpoint, payload, new AbortController().signal))
  const html = `<html><head><meta charset="utf-8"><style>body{margin:0;font-family:system-ui;color:#242424}</style></head><body><div id="root"></div><script>window.fetch=async(_url,options)=>{const data=JSON.parse(options.body);return new Response(JSON.stringify(await window.isolatedRpc(data.endpoint,data.payload)),{headers:{'Content-Type':'application/json'}})};</script><script>${client.outputFiles[0]!.text}</script></body></html>`
  await page.setContent(html)
  await page.locator('#dp-review-trigger').click()
  await page.getByRole('button', { name: '展望', exact: true }).click()
  await page.getByLabel('描述目标、偏好或临时变化').fill('明天19:10–20:35和朋友聚餐，下周完成论文修改。')
  await page.getByRole('button', { name: '先看安排', exact: true }).click()
  await page.getByLabel('活动 1名称').waitFor()
  // A plugin reload must restore the already-generated pending proposal.
  await page.goto('about:blank')
  await page.setContent(html)
  await page.locator('#dp-review-trigger').click()
  await page.getByLabel('活动 1名称').waitFor({ timeout: 6000 })
  assert.equal(ctx.prompts.length, 1)
  await page.getByLabel('活动 1名称').fill('与学长聚餐')
  await page.getByLabel('活动 1开始时间').fill('19:30')
  await page.getByLabel('活动 1结束时间').fill('21:00')
  await page.getByLabel('活动 1备注').fill('餐厅见')
  await page.getByLabel('任务 1名称').fill('论文修改初稿')
  await page.getByRole('button', { name: '指定时段', exact: true }).click()
  await page.getByLabel('任务 1日期').fill('2026-10-05')
  await page.getByLabel('任务 1开始时间').fill('11:00')
  await page.getByLabel('任务 1结束时间').fill('12:00')
  await page.getByLabel('任务 1备注').fill('完成第一节')
  await mkdir('output/playwright', { recursive: true })
  await page.screenshot({ path: 'output/playwright/agnes-editable-preview.png' })
  await page.getByRole('button', { name: '应用安排', exact: true }).click()
  await page.getByRole('button', { name: '保存修改', exact: true }).waitFor()
  await page.screenshot({ path: 'output/playwright/agnes-edited-result.png' })
  const party = service.dayPlan('2026-10-02').blocks.find((block) => block.title === '与学长聚餐')!
  const paper = service.dayPlan('2026-10-05').blocks.find((block) => block.title === '论文修改初稿')!
  assert.equal(party.startMinute, 1170); assert.equal(party.endMinute, 1260); assert.equal(party.note, '餐厅见')
  assert.equal(paper.startMinute, 660); assert.equal(paper.endMinute, 720); assert.equal(paper.note, '完成第一节')
  assert(service.dayPlan('2026-10-02').blocks.some((block) => block.title === '旧阅读位置' && block.disposition === 'deferred'))
  assert.equal(ctx.prompts.length, 1)
  console.log('Editable preview passed: exact times, titles, notes, task pinning, conflict replacement; one simulated AI call.')
} finally { await browser.close() }
