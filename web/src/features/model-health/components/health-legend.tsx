/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it under the terms
of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your
option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useTranslation } from 'react-i18next'

// HealthLegend explains the heartbeat block colors on the model health page.
// Rendered in the shared header area (visible to admins and regular users
// alike — non-admins see model-level strips too) so the three-color strip is
// self-explanatory: green = channel served the request (incl. moderation
// verdicts), amber = the request itself was broken, red = upstream trouble.
export function HealthLegend() {
  const { t } = useTranslation()
  const items = [
    { className: 'bg-success', label: t('Normal') },
    { className: 'bg-warning', label: t('Bad request (client)') },
    { className: 'bg-destructive', label: t('Upstream error') },
    { className: 'text-muted-foreground', label: t('No data'), dash: true },
  ]
  return (
    <div className='text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs'>
      {items.map((item) => (
        <span key={item.label} className='flex items-center gap-1.5'>
          {item.dash ? (
            <span className='w-2.5 text-center leading-none'>—</span>
          ) : (
            <span
              className={`size-2 shrink-0 rounded-[2px] ${item.className}`}
            />
          )}
          {item.label}
        </span>
      ))}
    </div>
  )
}
