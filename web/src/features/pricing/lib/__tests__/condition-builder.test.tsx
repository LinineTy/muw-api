// @muw-owned
import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { MATCH_GTE, MATCH_LT, type RequestCondition } from '../billing-expr'
import { ConditionBuilder } from '../condition-builder'
import { checkRequestDnfIssues } from '../condition-format'

const t = (key: string) => key

function timeGte(value: string): RequestCondition {
  return {
    source: 'time',
    timeFunc: 'day',
    timezone: 'Asia/Shanghai',
    mode: MATCH_GTE,
    value,
    rangeStart: '',
    rangeEnd: '',
  }
}

function timeLt(value: string): RequestCondition {
  return { ...timeGte(value), mode: MATCH_LT }
}

describe('checkRequestDnfIssues', () => {
  test('flags an OR branch that has no conditions', () => {
    const issues = checkRequestDnfIssues(
      [{ conditions: [timeGte('1')] }, { conditions: [] }],
      t
    )
    expect(issues.some((issue) => issue.branchIndex === 1)).toBe(true)
  })

  test('flags a branch whose bounds can never both hold', () => {
    const issues = checkRequestDnfIssues(
      [{ conditions: [timeGte('10'), timeLt('5')] }],
      t
    )
    expect(issues.some((issue) => issue.severity === 'error')).toBe(true)
  })

  test('stays quiet for a well-formed single branch', () => {
    expect(
      checkRequestDnfIssues([{ conditions: [timeGte('9'), timeLt('12')] }], t)
    ).toEqual([])
  })
})

describe('ConditionBuilder', () => {
  test('renders one row per branch, the OR join, preview and add buttons', () => {
    const onChange = vi.fn()
    render(
      <ConditionBuilder
        dnf={[{ conditions: [timeGte('9')] }, { conditions: [timeGte('21')] }]}
        onChange={onChange}
        renderRow={({ value }) => <span data-testid='row'>{value.value}</span>}
        createEmptyAtom={() => timeGte('0')}
        rowAddLabel='Add condition'
        branchAddLabel='Add OR branch'
        orLabel='OR'
        preview='preview text'
        translateIssue={(key) => key}
      />
    )
    expect(screen.getAllByTestId('row')).toHaveLength(2)
    expect(screen.getByText('OR')).toBeTruthy()
    expect(screen.getByText('preview text')).toBeTruthy()
    expect(screen.getByText('Add OR branch')).toBeTruthy()
  })

  test('renders issues handed to it', () => {
    render(
      <ConditionBuilder
        dnf={[{ conditions: [] }]}
        onChange={vi.fn()}
        renderRow={() => <span data-testid='row' />}
        createEmptyAtom={() => timeGte('0')}
        rowAddLabel='Add condition'
        branchAddLabel='Add OR branch'
        orLabel='OR'
        issues={checkRequestDnfIssues([{ conditions: [] }], t)}
        translateIssue={(key) => `translated:${key}`}
      />
    )
    expect(screen.getByText(/^translated:/)).toBeTruthy()
  })
})
