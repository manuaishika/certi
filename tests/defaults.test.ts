import { describe, it, expect } from 'vitest'
import { freshDb, rpc } from './helpers'
import { DEFAULT_PLANS, DEFAULT_SETTINGS } from '../src/lib/defaults'

describe('landing-page defaults mirror the database seed', () => {
  it('plans', async () => {
    const db = await freshDb(false)
    const live = await rpc<any[]>(db, 'anon', 'list_plans')
    expect(DEFAULT_PLANS).toEqual(live.map(({ sort, ...p }) => p))
  })
  it('settings', async () => {
    const db = await freshDb(false)
    expect(DEFAULT_SETTINGS).toEqual(await rpc(db, 'anon', 'get_public_settings'))
  })
})
