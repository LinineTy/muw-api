/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { StatusBadge, type StatusVariant } from '@/components/status-badge'

// successRateVariant maps a success percentage (0-100) to a badge color.
function successRateVariant(rate: number): StatusVariant {
  if (rate >= 99) return 'success'
  if (rate >= 90) return 'info'
  if (rate >= 70) return 'warning'
  return 'danger'
}

export function SuccessRateBadge({
  rate,
  className,
}: {
  rate: number
  className?: string
}) {
  return (
    <StatusBadge
      label={`${rate.toFixed(1)}%`}
      variant={successRateVariant(rate)}
      size='sm'
      copyable={false}
      className={className}
    />
  )
}
