// @muw-owned
import { useTranslation } from 'react-i18next'

// HealthLegend explains the heartbeat block colors on the model health page.
// Rendered in the shared header area (admins and regular users alike — both see
// the strips: model-level on the card head, per-channel on the tiles) so the
// colors are self-explanatory: green = channel served the request (incl.
// moderation verdicts), amber = the request itself was broken, red = upstream
// trouble. Swatches mirror the real block shape (3×10) rather than a square.
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
              className={`h-2.5 w-[3px] shrink-0 rounded-[1px] ${item.className}`}
            />
          )}
          {item.label}
        </span>
      ))}
    </div>
  )
}
