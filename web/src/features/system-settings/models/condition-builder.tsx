// @muw-owned
import { AlertTriangle, Plus, X } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'

import type { Dnf } from '@/features/pricing/lib/billing-expr'
import type { ConditionIssue } from '@/features/pricing/lib/condition-format'
import { cn } from '@/lib/utils'

export type ConditionRowRenderProps<T> = {
  value: T
  onChange: (next: T) => void
  onRemove: () => void
  /** Row-level issues (branchIndex + conditionIndex matching this row). */
  issues?: ConditionIssue[]
}

type ConditionBuilderProps<T> = {
  dnf: Dnf<T>
  onChange: (next: Dnf<T>) => void
  /** Row editor (tier condition vs request condition). */
  renderRow: (props: ConditionRowRenderProps<T>) => ReactNode
  createEmptyAtom: () => T
  rowAddLabel: string
  branchAddLabel: string
  /** Separator glyph between atoms within a branch (e.g. "AND"). */
  clauseSeparator?: string
  orLabel: string
  /** Live natural-language preview shown above the branches. */
  preview?: string
  /** Precomputed issues for this group (see checkRequestDnfIssues). */
  issues?: ConditionIssue[]
  /** Localizes an issue's i18n key (with params) for rendering. */
  translateIssue: (key: string, params?: Record<string, string | number>) => string
}

/**
 * Severity-aware issue box shared by the group-level and branch-level blocks:
 * any error turns the box red, an all-warning box turns amber, and each line
 * keeps its own severity color (mirrors RuleConditionRow).
 */
function IssueList({
  issues,
  translateIssue,
}: {
  issues: ConditionIssue[]
  translateIssue: (key: string, params?: Record<string, string | number>) => string
}) {
  const hasError = issues.some((issue) => issue.severity === 'error')
  return (
    <div
      className={cn(
        'flex items-start gap-1.5 rounded-md border px-2.5 py-2',
        hasError
          ? 'border-destructive/30 bg-destructive/5'
          : 'border-amber-500/30 bg-amber-500/5'
      )}
    >
      <AlertTriangle
        className={cn(
          'mt-0.5 h-3.5 w-3.5 shrink-0',
          hasError ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'
        )}
      />
      <div className='space-y-0.5'>
        {issues.map((issue) => (
          <p
            key={issue.key}
            className={cn(
              'text-xs',
              issue.severity === 'error'
                ? 'text-destructive'
                : 'text-amber-600 dark:text-amber-400'
            )}
          >
            {translateIssue(issue.key, issue.params)}
          </p>
        ))}
      </div>
    </div>
  )
}

/**
 * DNF condition builder: a list of OR branches, each a list of ANDed condition
 * rows. Shared by the tier cards and the request-rule group cards.
 */
export function ConditionBuilder<T>({
  dnf,
  onChange,
  renderRow,
  createEmptyAtom,
  rowAddLabel,
  branchAddLabel,
  clauseSeparator = 'AND',
  orLabel,
  preview,
  issues = [],
  translateIssue,
}: ConditionBuilderProps<T>) {
  const groupIssues = issues.filter(
    (issue) => issue.branchIndex === undefined && issue.conditionIndex === undefined
  )
  const branchIssues = (branchIndex: number) =>
    issues.filter(
      (issue) =>
        issue.branchIndex === branchIndex && issue.conditionIndex === undefined
    )
  const atomIssues = (branchIndex: number, conditionIndex: number) =>
    issues.filter(
      (issue) =>
        issue.branchIndex === branchIndex &&
        issue.conditionIndex === conditionIndex
    )

  const replaceBranch = (branchIndex: number, next: Dnf<T>[number]) => {
    onChange(dnf.map((branch, i) => (i === branchIndex ? next : branch)))
  }
  const handleAtomChange = (
    branchIndex: number,
    conditionIndex: number,
    next: T
  ) => {
    const branch = dnf[branchIndex]
    replaceBranch(branchIndex, {
      ...branch,
      conditions: branch.conditions.map((cond, i) =>
        i === conditionIndex ? next : cond
      ),
    })
  }
  const handleAtomRemove = (branchIndex: number, conditionIndex: number) => {
    const branch = dnf[branchIndex]
    replaceBranch(branchIndex, {
      ...branch,
      conditions: branch.conditions.filter((_, i) => i !== conditionIndex),
    })
  }
  const handleAddAtom = (branchIndex: number) => {
    const branch = dnf[branchIndex]
    replaceBranch(branchIndex, {
      ...branch,
      conditions: [...branch.conditions, createEmptyAtom()],
    })
  }
  const handleAddBranch = () => {
    onChange([...dnf, { conditions: [createEmptyAtom()] }])
  }
  const handleRemoveBranch = (branchIndex: number) => {
    if (dnf.length <= 1) return
    onChange(dnf.filter((_, i) => i !== branchIndex))
  }

  return (
    <div className='space-y-2'>
      {groupIssues.length > 0 && (
        <IssueList issues={groupIssues} translateIssue={translateIssue} />
      )}
      {preview && (
        <p className='text-muted-foreground min-w-0 text-xs leading-5'>
          {preview}
        </p>
      )}

      {dnf.map((branch, branchIndex) => (
        <div key={branchIndex} className='space-y-1.5'>
          <div className='space-y-1.5'>
            {branch.conditions.map((atom, conditionIndex) => (
              <div
                key={conditionIndex}
                className='flex items-start gap-2 rounded-md'
              >
                {conditionIndex > 0 && (
                  <span className='text-muted-foreground mt-3 shrink-0 text-xs'>
                    {clauseSeparator}
                  </span>
                )}
                <div className='min-w-0 flex-1'>
                  {renderRow({
                    value: atom,
                    onChange: (next) =>
                      handleAtomChange(branchIndex, conditionIndex, next),
                    onRemove: () =>
                      handleAtomRemove(branchIndex, conditionIndex),
                    issues: atomIssues(branchIndex, conditionIndex),
                  })}
                </div>
              </div>
            ))}
            <Button
              variant='outline'
              size='sm'
              className='h-7 px-2 text-xs'
              onClick={() => handleAddAtom(branchIndex)}
            >
              <Plus className='mr-1 h-3 w-3' />
              {rowAddLabel}
            </Button>
          </div>

          {branchIssues(branchIndex).length > 0 && (
            <IssueList
              issues={branchIssues(branchIndex)}
              translateIssue={translateIssue}
            />
          )}

          {branchIndex < dnf.length - 1 && (
            <div className='flex items-center gap-2'>
              <span className='bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs font-medium'>
                {orLabel}
              </span>
              <Button
                variant='ghost'
                size='sm'
                className='h-6 w-6 p-0'
                onClick={() => handleRemoveBranch(branchIndex)}
                aria-label='remove OR branch'
              >
                <X className='h-3 w-3' />
              </Button>
            </div>
          )}
        </div>
      ))}

      <Button
        variant='outline'
        size='sm'
        className='h-7 px-2 text-xs'
        onClick={handleAddBranch}
      >
        <Plus className='mr-1 h-3 w-3' />
        {branchAddLabel}
      </Button>
    </div>
  )
}
