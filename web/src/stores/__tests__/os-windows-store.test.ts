// @muw-owned
import { beforeEach, describe, expect, test } from 'vitest'

import { useOsWindowsStore } from '../os-windows-store'

/**
 * 窗口内跳转后回填窗口自身的 url 与标题 —— 否则窗口标题栏与 Dock 会一直停在
 * "打开时那一页"(窗口内跳到别的应用或详情页后对不上)。
 */
describe('os-windows-store · syncWindowUrl', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useOsWindowsStore.setState({ windows: [], activeId: null })
  })

  function openFirst() {
    useOsWindowsStore
      .getState()
      .openWindow({ url: '/channels', title: 'Channels' })
    return useOsWindowsStore.getState().windows[0].id
  }

  test('同步目标窗口的 url 与标题,其余窗口不动', () => {
    const first = openFirst()
    useOsWindowsStore.getState().openWindow({ url: '/keys', title: 'Keys' })

    useOsWindowsStore.getState().syncWindowUrl(first, '/records/42', 'Records')

    const [updated, untouched] = useOsWindowsStore.getState().windows
    expect(updated.url).toBe('/records/42')
    expect(updated.title).toBe('Records')
    expect(untouched.url).toBe('/keys')
  })

  test('同步后落进 sessionStorage(刷新恢复拿到的是新地址)', () => {
    const id = openFirst()
    useOsWindowsStore.getState().syncWindowUrl(id, '/records/42', 'Records')

    const persisted = JSON.parse(sessionStorage.getItem('os-windows') ?? '[]')
    expect(persisted[0]).toMatchObject({ url: '/records/42', title: 'Records' })
  })

  test('值没变化就不写(每次导航都上报,不能每次都落盘)', () => {
    const id = openFirst()
    sessionStorage.clear()

    useOsWindowsStore.getState().syncWindowUrl(id, '/channels', 'Channels')

    expect(sessionStorage.getItem('os-windows')).toBeNull()
  })

  test('深链给的是具体地址：已有的同路径窗不在那儿就另开一个', () => {
    openFirst()

    useOsWindowsStore
      .getState()
      .openWindow({ url: '/channels?tab=disabled', title: 'Channels' })

    expect(useOsWindowsStore.getState().windows).toHaveLength(2)
  })

  test('同路径不同查询串算同一个窗（窗口带着 tab 状态时,点磁贴不重复开）', () => {
    const id = openFirst()
    useOsWindowsStore
      .getState()
      .syncWindowUrl(id, '/channels?tab=a', 'Channels')

    useOsWindowsStore
      .getState()
      .openWindow({ url: '/channels', title: 'Channels' })

    expect(useOsWindowsStore.getState().windows).toHaveLength(1)
  })

  test('上报历史可导航性,且不落 sessionStorage(刷新后失效)', () => {
    const id = openFirst()
    sessionStorage.clear()

    useOsWindowsStore.getState().setWindowHistory(id, true, false)

    const win = useOsWindowsStore.getState().windows[0]
    expect(win.canBack).toBe(true)
    expect(win.canForward).toBe(false)
    expect(sessionStorage.getItem('os-windows')).toBeNull()
  })
})
