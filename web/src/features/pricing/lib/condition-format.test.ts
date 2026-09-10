// @muw-owned
import { describe, expect, it } from 'vitest'

import {
  MATCH_RANGE,
  type RequestCondition,
  type RequestDnf,
} from './billing-expr'
import {
  checkRequestDnfIssues,
  formatConditionText,
  formatRequestDnfText,
  formatTierDnfText,
  type ConditionIssue,
} from './condition-format'

const t = (key: string): string => key

describe('formatRequestDnfText', () => {
  it('joins branches with a localized OR word', () => {
    const text = formatRequestDnfText(
      [
        {
          conditions: [{ source: 'param', path: 'a', mode: 'eq', value: 'x' }],
        },
        {
          conditions: [{ source: 'param', path: 'b', mode: 'eq', value: 'y' }],
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
          conditions: [{ source: 'param', path: 'ok', mode: 'eq', value: '1' }],
        },
      ],
      t
    )
    // The dead branch gets a branch-level conflict error, the alive branch keeps
    // the group alive (no group-level "never match" error).
    expect(
      issues.some((i) => i.branchIndex === 0 && i.conditionIndex === undefined)
    ).toBe(true)
    expect(
      issues.some(
        (i) => i.branchIndex === undefined && i.conditionIndex === undefined
      )
    ).toBe(false)
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
          issue.key ===
            'Conflicting conditions in this rule make it never match' &&
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
          issue.key ===
            'This OR branch has no conditions and will be ignored when saved' &&
          issue.branchIndex === 0
      )
    ).toBe(true)
    expect(
      issues.some(
        (issue: ConditionIssue) =>
          issue.key ===
            'Conflicting conditions in this rule make it never match' &&
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
          issue.key ===
          'This OR branch has no conditions and will be ignored when saved'
      )
    ).toBe(true)
    expect(
      issues.some(
        (issue: ConditionIssue) =>
          issue.key ===
          'Conflicting conditions in this rule make it never match'
      )
    ).toBe(false)
  })

  it('an empty branch next to a healthy branch stays a warning, group stays alive', () => {
    const issues = checkRequestDnfIssues(
      [
        { conditions: [] },
        {
          conditions: [{ source: 'param', path: 'ok', mode: 'eq', value: '1' }],
        },
      ] as RequestDnf,
      t
    )
    expect(
      issues.some(
        (issue: ConditionIssue) =>
          issue.key ===
          'This OR branch has no conditions and will be ignored when saved'
      )
    ).toBe(true)
    expect(
      issues.some(
        (issue: ConditionIssue) =>
          issue.key ===
          'Conflicting conditions in this rule make it never match'
      )
    ).toBe(false)
  })
})

// Upstream #6934 changed the time-range semantics: a same-day window is
// serialized as `>= s && < e` (AND), an overnight window as `>= s || < e` (OR).
// The formatter may only print a window when the bounds agree with the source
// operator — `||` with start <= end covers every value and `&&` with
// start >= end can never match, so both keep the raw two-comparison form.
const zh = (key: string): string =>
  ({
    'Every day': '每天',
    'Every week': '每周',
    'Next day': '次日',
    'Weekday range {{start}} to {{end}}': '{{start}}~{{end}}',
    Sunday: '周日',
    Monday: '周一',
    Friday: '周五',
    Saturday: '周六',
  })[key] ?? key

const timeRange = (
  timeFunc: 'hour' | 'weekday',
  rangeStart: string,
  rangeEnd: string,
  rangeOp?: 'and' | 'or'
): RequestCondition => ({
  source: 'time',
  timeFunc,
  timezone: 'Asia/Shanghai',
  mode: MATCH_RANGE,
  value: '',
  rangeStart,
  rangeEnd,
  rangeOp,
})

describe('formatConditionText · time ranges', () => {
  it('prints a same-day window built with && as a window', () => {
    expect(formatConditionText(timeRange('hour', '14', '18', 'and'), zh)).toBe(
      '每天 14:00~18:00'
    )
  })

  it('prints a same-day weekday window as a day range', () => {
    expect(formatConditionText(timeRange('weekday', '1', '6', 'and'), zh)).toBe(
      '周一~周五'
    )
  })

  it('prints an overnight window built with || as before', () => {
    expect(formatConditionText(timeRange('hour', '18', '14', 'or'), zh)).toBe(
      '每天 18:00~次日 14:00'
    )
  })

  it('keeps raw comparisons for a legacy || range that covers the whole day', () => {
    expect(formatConditionText(timeRange('hour', '14', '18', 'or'), zh)).toBe(
      '每天 ≥ 14:00 · 每天 < 18:00'
    )
  })

  it('keeps raw comparisons for an && range that can never match', () => {
    expect(formatConditionText(timeRange('hour', '18', '6', 'and'), zh)).toBe(
      '每天 ≥ 18:00 · 每天 < 6:00'
    )
  })

  it('treats an editor-authored range without a source operator as a window', () => {
    expect(formatConditionText(timeRange('hour', '9', '12'), zh)).toBe(
      '每天 9:00~12:00'
    )
    expect(formatConditionText(timeRange('weekday', '5', '1'), zh)).toBe(
      '周五~周日'
    )
  })
})

describe('checkRequestDnfIssues · time ranges', () => {
  const ALWAYS_MATCHES =
    'This time range covers the whole day and always matches'
  const NEVER_MATCHES =
    'This time range never matches because its start is not before its end'

  it('accepts a same-day window', () => {
    expect(
      checkRequestDnfIssues(
        [{ conditions: [timeRange('hour', '14', '18', 'and')] }],
        t
      )
    ).toEqual([])
  })

  it('accepts an overnight window', () => {
    expect(
      checkRequestDnfIssues(
        [{ conditions: [timeRange('hour', '18', '14', 'or')] }],
        t
      )
    ).toEqual([])
  })

  it('flags a legacy || same-day range as always matching', () => {
    expect(
      checkRequestDnfIssues(
        [{ conditions: [timeRange('hour', '14', '18', 'or')] }],
        t
      )
    ).toEqual([
      {
        severity: 'error',
        key: ALWAYS_MATCHES,
        branchIndex: 0,
        conditionIndex: 0,
      },
    ])
  })

  it('flags an && range whose start is not before its end as never matching', () => {
    expect(
      checkRequestDnfIssues(
        [{ conditions: [timeRange('hour', '18', '6', 'and')] }],
        t
      )
    ).toEqual([
      {
        severity: 'error',
        key: NEVER_MATCHES,
        branchIndex: 0,
        conditionIndex: 0,
      },
    ])
  })

  it('flags an editor-authored range with equal bounds as never matching', () => {
    expect(
      checkRequestDnfIssues([{ conditions: [timeRange('hour', '9', '9')] }], t)
    ).toEqual([
      {
        severity: 'error',
        key: NEVER_MATCHES,
        branchIndex: 0,
        conditionIndex: 0,
      },
    ])
  })
})
