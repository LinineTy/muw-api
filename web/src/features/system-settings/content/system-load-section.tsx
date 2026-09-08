// @muw-owned
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Separator } from '@/components/ui/separator'

import { SystemInfoSection } from '../maintenance/system-info-section'
import { SettingsSwitchField } from '../components/settings-form-layout'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

type SystemLoadSectionProps = {
  enabled: boolean
}

export function SystemLoadSection({ enabled }: SystemLoadSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [isEnabled, setIsEnabled] = useState(enabled)

  useEffect(() => {
    setIsEnabled(enabled)
  }, [enabled])

  const handleToggleEnabled = async (checked: boolean) => {
    try {
      await updateOption.mutateAsync({
        key: 'console_setting.system_load_enabled',
        value: checked,
      })
      setIsEnabled(checked)
      toast.success(t('Setting saved'))
    } catch {
      toast.error(t('Failed to update setting'))
    }
  }

  return (
    <SettingsSection title={t('System Load')}>
      <SettingsSwitchField
        checked={isEnabled}
        onCheckedChange={handleToggleEnabled}
        label={t('Show system load on the dashboard')}
        description={t(
          'Displays CPU and memory usage indicators on the Overview page.'
        )}
      />
      <Separator className='my-4' />
      <SystemInfoSection />
    </SettingsSection>
  )
}
