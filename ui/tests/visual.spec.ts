import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  const fixedTs = '2026-01-01T00:00:00.000Z'
  await page.route('**/api/agents', async (route) => {
    await route.fulfill({ json: [{ id: 'a1', name: 'Code Fixer', description: '', provider: 'openai', model: 'gpt-4.1-mini', system_prompt: '', allowed_tools: [], created_at: fixedTs, updated_at: fixedTs }] })
  })
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ json: { id: 'r1', status: 'queued' } })
      return
    }
    await route.fulfill({ json: [{ id: 'r1', agent_id: 'a1', status: 'running', task: 'fix tests', workspace_path: '/tmp/ws', provider: 'openai', model: 'gpt-4.1-mini', max_steps: 20, created_at: fixedTs, updated_at: fixedTs }] })
  })
  await page.route('**/api/sessions/r1', async (route) => {
    await route.fulfill({ json: { id: 'r1', agent_id: 'a1', status: 'running', task: 'fix tests', workspace_path: '/tmp/ws', provider: 'openai', model: 'gpt-4.1-mini', max_steps: 20, created_at: fixedTs, updated_at: fixedTs } })
  })
  await page.route('**/api/sessions/r1/trace', async (route) => {
    await route.fulfill({ json: [{ id: 'e1', step_id: 's1', event_type: 'run.started', seq: 1, payload: { model: 'gpt-4.1-mini' }, created_at: fixedTs }] })
  })
  await page.route('**/api/sessions/r1/artifacts', async (route) => {
    await route.fulfill({ json: [] })
  })
  await page.route('**/api/providers', async (route) => {
    await route.fulfill({ json: [{ provider: 'openai', supports_tools: true, supports_streaming: true }] })
  })
})

test('sessions page visual', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveScreenshot('runs-page.png', { fullPage: true })
})

test('session detail visual', async ({ page }) => {
  await page.goto('/sessions/r1')
  await expect(page).toHaveScreenshot('run-detail-page.png', { fullPage: true })
})
