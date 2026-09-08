// @muw-owned
import { describe, expect, it } from 'vitest'

import {
  checkRequestDnfIssues,
  formatRequestDnfText,
  formatTierDnfText,
  type ConditionIssue,
} from './condition-format'
import type { RequestDnf } from './billing-expr'

const t = (key: string): string => key

describe('formatRequestDnfText', () => {
  it('joins branches with a localized OR word', () => {
    const text = formatRequestDnfText(
      [
        {
          conditions: [
            { source: 'param', path: 'a', mode: 'eq', value: 'x' },
          ],
        },
        {
          conditions: [
            { source: 'param', path: 'b', mode: 'eq', value: 'y' },
          ],
        },
      ],
      t
    )
    expect(text).toBe('Body param a = x OR Body param b = y')
  })
})

describe('formatTierDnfText', () => {
  it('renders AND within a clause and OR between branches', () => {
    const text = formatTierDnfText(
      [
        {
          conditions: [
            { var: 'len', op: '<', value: 32000 },
            { var: 'c', op: '<', value: 200 },
          ],
        },
        { conditions: [{ var: 'len', op: '>', value: 100000 }] },
      ],
      t
    )
    expect(text).toBe('Length < 32K && Output < 200 OR Length > 100K')
  })
})

describe('checkRequestDnfIssues', () => {
  it('flags a never-matching branch but keeps others alive', () => {
    const issues = checkRequestDnfIssues(
      [
        // hour >= 12 && hour < 6 -> empty window, never matches
        {
          conditions: [
            {
              source: 'time',
              timeFunc: 'hour',
              timezone: 'UTC',
              mode: 'gte',
              value: '12',
              rangeStart: '',
              rangeEnd: '',
            },
            {
              source: 'time',
              timeFunc: 'hour',
              timezone: 'UTC',
              mode: 'lt',
              value: '6',
              rangeStart: '',
              rangeEnd: '',
            },
          ],
        },
        {
          conditions: [
            { source: 'param', path: 'ok', mode: 'eq', value: '1' },
          ],
        },
      ],
      t
    )
    // The dead branch gets a branch-level conflict error, the alive branch keeps
    // the group alive (no group-level "never match" error).
    expect(issues.some((i) => i.branchIndex === 0 && i.conditionIndex === undefined)).toBe(true)
    expect(issues.some((i) => i.branchIndex === undefined && i.conditionIndex === undefined)).toBe(false)
  })

  it('errors on a rule group where every branch never matches', () => {
    const deadBranch = {
      conditions: [
        {
          source: 'time',
          timeFunc: 'hour',
          timezone: 'UTC',
          mode: 'gte',
          value: '12',
          rangeStart: '',
          rangeEnd: '',
        },
        {
          source: 'time',
          timeFunc: 'hour',
          timezone: 'UTC',
          mode: 'lt',
          value: '6',
          rangeStart: '',
          rangeEnd: '',
        },
      ],
    }
    const issues = checkRequestDnfIssues([deadBranch] as RequestDnf, t)
    expect(
      issues.some(
        (issue: ConditionIssue) =>
          issue.key === 'Conflicting conditions in this rule make it never match' &&
          issue.branchIndex === undefined &&
          issue.conditionIndex === undefined
      )
    ).toBe(true)
  })

  it('an empty branch must not mask a never-match group (it is dropped on serialize)', () => {
    // The empty OR branch is dropped by the serializer, leaving only the dead
    // `hour >= 12 && hour < 6` window — the group still never matches.
    const issues = checkRequestDnfIssues(
      [
        { conditions: [] },
        {
          conditions: [
            {
              source: 'time',
              timeFunc: 'hour',
              timezone: 'UTC',
              mode: 'gte',
              value: '12',
              rangeStart: '',
              rangeEnd: '',
            },
            {
              source: 'time',
              timeFunc: 'hour',
              timezone: 'UTC',
              mode: 'lt',
              value: '6',
              rangeStart: '',
              rangeEnd: '',
            },
          ],
        },
      ] as RequestDnf,
      t
    )
    expect(
      issues.some(
        (issue: ConditionIssue) =>
          issue.key === 'This OR branch has no conditions and will be ignored when saved' &&
          issue.branchIndex === 0
      )
    ).toBe(true)
    expect(
      issues.some(
        (issue: ConditionIssue) =>
          issue.key === 'Conflicting conditions in this rule make it never match' &&
          issue.branchIndex === undefined &&
          issue.conditionIndex === undefined
      )
    ).toBe(true)
  })

  it('a group of only empty branches is ignored, not never-matching', () => {
    const issues = checkRequestDnfIssues([{ conditions: [] }] as RequestDnf, t)
    expect(
      issues.some(
        (issue: ConditionIssue) =>
          issue.key === 'This OR branch has no conditions and will be ignored when saved'
      )
    ).toBe(true)
    expect(
      issues.some(
        (issue: ConditionIssue) =>
          issue.key === 'Conflicting conditions in this rule make it never match'
      )
    ).toBe(false)
  })

  it('an empty branch next to a healthy branch stays a warning, group stays alive', () => {
    const issues = checkRequestDnfIssues(
      [
        { conditions: [] },
        { conditions: [{ source: 'param', path: 'ok', mode: 'eq', value: '1' }] },
      ] as RequestDnf,
      t
    )
    expect(
      issues.some(
        (issue: ConditionIssue) =>
          issue.key === 'This OR branch has no conditions and will be ignored when saved'
      )
    ).toBe(true)
    expect(
      issues.some(
        (issue: ConditionIssue) =>
          issue.key === 'Conflicting conditions in this rule make it never match'
      )
    ).toBe(false)
  })
})
