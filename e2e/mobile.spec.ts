import { test, expect, type Page } from '@playwright/test'

// A typical phone: 390 x 844, touch, mobile viewport semantics.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })

const errors: string[] = []
test.beforeEach(({ page }) => { page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()) }) })
test.afterEach(() => { expect(errors, 'browser console errors').toEqual([]) })

const noSideScroll = async (page: Page) => {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  expect(sw, 'page must not scroll sideways').toBeLessThanOrEqual(cw)
}
const login = async (page: Page, label: string) => { await page.goto('/login'); await page.getByRole('button', { name: label }).click(); await page.waitForURL(/\/admin/) }

test('public pages fit a phone without sideways scrolling', async ({ page }) => {
  for (const path of ['/', '/claim', '/login', '/signup', '/events/annual-language-day-2026', '/verify/CGM-NOPE']) {
    await page.goto(path); await page.waitForLoadState('domcontentloaded'); await page.waitForTimeout(1500)
    await noSideScroll(page)
  }
})

test('landing: menu, full-width actions, stacked comparison cards (no cut-off tables)', async ({ page }) => {
  await page.goto('/')
  const menu = page.getByRole('button', { name: 'Menu' })
  await expect(menu).toBeVisible()
  const box = (await menu.boundingBox())!; expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44)
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeHidden()                 // the desktop nav is not squeezed in

  const cta = page.getByRole('link', { name: 'Organise an event' }).first()
  expect((await cta.boundingBox())!.width).toBeGreaterThan(330)                                    // thumb-friendly, full width

  await menu.click(); await expect(menu).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('navigation', { name: 'Menu' }).getByRole('link', { name: 'Verify a certificate' }).click()
  await expect(page).toHaveURL(/#verify/); await expect(page.getByRole('navigation', { name: 'Menu' })).toBeHidden()   // closes after navigating

  await expect(page.getByRole('list', { name: /compared with CerGeMA/ })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Plan comparison' })).toBeVisible()
  await expect(page.locator('table')).toHaveCount(0)
  await noSideScroll(page)
})

test('forms use 16px text so iOS does not zoom the page on focus', async ({ page }) => {
  await page.goto('/events/annual-language-day-2026'); await page.locator('#name_en').waitFor()
  for (const sel of ['#name_en', '#mobile', '#email']) expect(await page.locator(sel).evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
  await expect(page.getByRole('radio').first()).toBeVisible()
  const field = (await page.locator('#name_en').boundingBox())!; expect(field.height).toBeGreaterThanOrEqual(40)
})

test('console: participants become editable cards, tabs scroll, designer has touch controls', async ({ page }) => {
  await login(page, 'Pro school')
  await noSideScroll(page)
  await page.goto('/admin/events'); await page.getByText('Annual Language Day 2026').click()
  await expect(page.getByRole('list', { name: 'Participants' })).toBeVisible(); await expect(page.locator('table')).toHaveCount(0)
  const approve = page.getByRole('button', { name: /Approved|Approve$/ }).first(); expect((await approve.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await noSideScroll(page)

  await page.getByText('Certificate designer').click()
  const name = page.locator('[data-field=name]'); await expect(name).toBeVisible()
  await page.getByLabel('Field to move').selectOption('name')
  const before = parseFloat((await name.getAttribute('style'))!.match(/top:\s*([\d.]+)%/)![1])
  await page.getByRole('button', { name: 'Move down' }).click(); await page.getByRole('button', { name: 'Move down' }).click()
  await expect.poll(async () => parseFloat((await name.getAttribute('style'))!.match(/top:\s*([\d.]+)%/)![1])).toBeGreaterThan(before + 1.5)
  await noSideScroll(page)
})

test('scanner is usable one-handed: big result area, camera fallback, manual code', async ({ page }) => {
  await login(page, 'Enterprise')
  await page.goto('/admin/scan'); await expect(page.getByText('Gate check-in')).toBeVisible()
  await page.getByLabel('Pass code').fill('pnope'); await page.getByRole('button', { name: 'Check in' }).click()
  await expect(page.getByRole('status')).toContainText('Unknown pass')
  expect((await page.getByLabel('Pass code').boundingBox())!.height).toBeGreaterThanOrEqual(40)
  await noSideScroll(page)
})

test('billing history is a card list on phones', async ({ page }) => {
  await login(page, 'Pro school'); await page.goto('/admin/billing'); await expect(page.getByText('Wallet balance')).toBeVisible()
  await page.getByRole('button', { name: /^Pay with/ }).click(); await page.getByRole('button', { name: 'Simulate successful payment' }).click()
  await expect(page.locator('table')).toHaveCount(0); await expect(page.getByText('topup').first()).toBeVisible()
  await noSideScroll(page)
})
