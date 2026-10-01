import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

// Runs against the demo backend (in-browser Postgres with the production migrations), so no server is needed.
const errors: string[] = []
test.beforeEach(({ page }) => { page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()) }) })
test.afterEach(() => { expect(errors, 'browser console errors').toEqual([]) })

const login = async (page: Page, label: string) => { await page.goto('/login'); await page.getByRole('button', { name: label }).click(); await page.waitForURL(/\/admin/) }

test('participant journey: register → ID pass → claim → feedback gate → PDF/PNG → verify', async ({ page, browser }) => {
  await page.goto('/events/svabhasha-samman-2026')
  await page.locator('#name_en').fill('Riya Menghani'); await page.locator('#name_hi').fill('रिया मेंघानी'); await page.locator('#mobile').fill('98111 22233')
  await page.locator('#institution').fill('Sunrise School'); await page.locator('#grade').fill('7')
  await page.getByRole('button', { name: 'Register' }).click()
  await expect(page.getByText('Please confirm your details')).toBeVisible()
  await page.getByRole('button', { name: 'Confirm & register' }).click()
  await page.waitForURL(/\/pass\//); await expect(page.getByText('You are registered')).toBeVisible()

  // invalid input is caught before submission
  await page.goto('/events/svabhasha-samman-2026'); await page.locator('#name_en').fill('X Y'); await page.locator('#mobile').fill('1234567890')
  await page.getByRole('button', { name: 'Register' }).click(); await expect(page.getByText('valid 10-digit')).toBeVisible()

  // organiser approves + issues
  await login(page, 'Pro school')
  await page.goto('/admin/events'); await page.getByText('Svabhasha Samman 2026').click()
  const cell = page.getByLabel('name_en for Riya Menghani')
  await cell.fill('Riya Menghanii'); await cell.blur(); await cell.fill('Riya Menghani'); await cell.blur()   // edit and edit-back both persist
  await page.getByRole('button', { name: 'Approve all' }).click()
  await page.getByRole('button', { name: 'Issue certificates' }).click()
  await expect(page.getByText(/Issued 3 certificate/)).toBeVisible()
  await page.getByText('Logout').click()

  // participant claims by mobile number
  await page.goto('/claim?q=9811122233'); await page.getByText('Riya Menghani').click()
  await expect(page.getByText('Two quick questions')).toBeVisible()
  await expect(page.getByRole('button', { name: /Download PDF/ })).toHaveCount(0)          // gated until feedback
  await page.getByLabel('5 star').click(); await page.locator('textarea').fill('Loved it'); await page.getByRole('button', { name: 'Unlock download' }).click()
  const pdf = page.waitForEvent('download'); await page.getByRole('button', { name: /Download PDF/ }).click()
  const bytes = readFileSync(await (await pdf).path()); expect(bytes.subarray(0, 5).toString()).toBe('%PDF-'); expect(bytes.length).toBeGreaterThan(50_000)
  const png = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download PNG' }).click()
  const img = readFileSync(await (await png).path()); expect(img.readUInt32BE(16)).toBe(3508); expect(img.readUInt32BE(20)).toBe(2480)   // 300 DPI A4 landscape
  const certId = (await page.content()).match(/CGM-[A-Z0-9]{10}/)![0]

  await page.goto(`/verify/${certId}`); await expect(page.getByText('Authentic certificate')).toBeVisible()
  await page.goto('/verify/CGM-NOPE'); await expect(page.getByText('Not found')).toBeVisible()
})

test('designer: drag a field, AI background, plan gating', async ({ page }) => {
  await login(page, 'Pro school')
  await page.goto('/admin/events'); await page.getByText('Svabhasha Samman 2026').click(); await page.getByText('Certificate designer').click()
  const handle = page.locator('[data-field=name]'); await expect(handle).toBeVisible()
  const b = (await handle.boundingBox())!
  await page.mouse.move(b.x + 8, b.y + 5); await page.mouse.down(); await page.mouse.move(b.x + 8, b.y + 40, { steps: 5 }); await page.mouse.up()
  await page.locator('textarea').fill('blue royal border with gold'); await page.getByRole('button', { name: 'Generate' }).click()
  await expect(page.getByText(/AI background ready/)).toBeVisible({ timeout: 30_000 })
  await page.getByText('Logout').click()

  await login(page, 'Free trust'); await page.goto('/admin/events/new')
  await expect(page.getByText(/need the Event Lifecycle module/)).toBeVisible()
})

test('enterprise: attendance scanner, white-label branding, billing with mock payment', async ({ page }) => {
  await login(page, 'Enterprise')
  await page.goto('/admin/scan'); await expect(page.getByText('Gate check-in')).toBeVisible()
  await page.getByPlaceholder(/Or type pass code/).fill('PNOPE'); await page.getByRole('button', { name: 'Check in' }).click(); await expect(page.getByText('Unknown pass')).toBeVisible()
  await page.goto('/admin/orgs'); await expect(page.getByText('White-label & custom domain')).toBeVisible()
  await page.goto('/admin/billing'); await page.getByRole('button', { name: /^Pay with/ }).click()
  await page.getByRole('button', { name: 'Simulate successful payment' }).click(); await expect(page.getByText('₹1,000')).toBeVisible()
})

test('roles: volunteer is confined to the scanner, affiliate to the partner portal, super sees platform pages', async ({ page }) => {
  await login(page, 'Gate volunteer'); await page.goto('/admin/billing'); await page.waitForURL(/\/admin\/scan/)
  await page.getByText('Logout').click()
  await login(page, 'Affiliate'); await expect(page.getByText('Partner portal').first()).toBeVisible(); await page.goto('/admin/events'); await page.waitForURL(/\/admin\/partner/)
  await page.getByText('Logout').click()
  await login(page, 'Super Admin'); await expect(page.getByText('Platform overview')).toBeVisible()
  for (const [path, text] of [['/admin/plans', 'Plans & entitlements'], ['/admin/affiliates', 'Affiliate coupons'], ['/admin/settings', 'Platform settings']]) { await page.goto(path); await expect(page.getByText(text).first()).toBeVisible() }
})

test('Hindi UI and white-label host', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Change language' }).click()
  await expect(page.getByRole('heading', { name: 'स्मार्ट इवेंट, तुरंत प्रमाणपत्र' })).toBeVisible()
  await page.reload(); await expect(page.getByRole('heading', { name: 'स्मार्ट इवेंट, तुरंत प्रमाणपत्र' })).toBeVisible()   // persisted
  // a tenant's verified custom domain swaps in their brand and hides CerGeMA's
  await page.goto('http://olympiad.localhost:4173/'); await expect(page.getByRole('link', { name: 'Olympiad Certs' })).toBeVisible({ timeout: 45_000 })   // fresh origin boots its own in-browser DB
  await expect(page.getByText('Mangal Hands')).toHaveCount(0)
})
