// @muw-owned
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'

type DbStatus = {
  ready: boolean
  path: string
  size: number
  built_at: number
  updated_at: number
  error?: string
}

type IpGeoStatus = {
  enabled: boolean
  url_v4: string
  url_v6: string
  v4: DbStatus
  v6: DbStatus
  last_error?: string
  last_check_at: number
  last_loaded_at: number
}

type IpGeoForm = {
  enabled: boolean
  url_v4: string
  url_v6: string
}

type IpGeoResponse = {
  success: boolean
  message?: string
  /** 仅在"立即更新"时有意义：false = 上游没有新版，没有下载 */
  changed?: boolean
  data?: IpGeoStatus
}

const formatDate = (ts?: number) =>
  ts && ts > 0 ? new Date(ts * 1000).toLocaleString() : '-'

const formatSize = (bytes?: number) =>
  bytes && bytes > 0 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '-'

/**
 * 离线 IP 归属地设置。
 *
 * 数据源地址落库（options 表），不依赖环境变量；「立即更新」会下载数据文件并在
 * 进程内热加载 —— 不需要重启容器，也不会因为更新失败丢掉正在用的旧库。
 */
export function IpGeoSection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const statusQuery = useQuery({
    queryKey: ['ip-geo-status'],
    queryFn: async () => {
      const res = await api.get('/api/ip_geo/status')
      return (res.data as IpGeoResponse).data as IpGeoStatus
    },
  })
  const status = statusQuery.data

  const formDefaults = useMemo(
    () => ({
      enabled: status?.enabled ?? true,
      url_v4: status?.url_v4 ?? '',
      url_v6: status?.url_v6 ?? '',
    }),
    [status?.enabled, status?.url_v4, status?.url_v6]
  )

  const form = useForm<IpGeoForm>({ defaultValues: formDefaults })
  useResetForm(form, formDefaults)

  const saveMutation = useMutation({
    mutationFn: async (values: IpGeoForm) => {
      const res = await api.put('/api/ip_geo/config', values)
      return res.data as IpGeoResponse
    },
    onSuccess: (body) => {
      if (body?.success === false) {
        toast.error(body.message || t('Save failed'))
        return
      }
      queryClient.setQueryData(['ip-geo-status'], body.data)
      toast.success(t('Setting updated successfully'))
    },
    onError: () => toast.error(t('Save failed')),
  })

  const updateMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/api/ip_geo/update')
      return res.data as IpGeoResponse
    },
    onSuccess: (body) => {
      queryClient.setQueryData(['ip-geo-status'], body.data)
      if (body?.success === false) {
        // 后端会给出原因（例如"已有更新任务正在进行中"），照原样透出
        toast.error(`${t('IP geolocation update failed')}：${body.message ?? ''}`)
        return
      }
      if (body?.changed === false) {
        toast.info(t('IP geolocation database is up to date'))
        return
      }
      toast.success(t('IP geolocation database updated'))
    },
    onError: () => toast.error(t('IP geolocation update failed')),
  })

  const renderDb = (label: string, db?: DbStatus) => (
    <div className='flex flex-col gap-1.5 rounded-lg border p-3 text-xs'>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-sm font-medium'>{label}</span>
        <Badge variant={db?.ready ? 'secondary' : 'outline'}>
          {db?.ready ? t('Database ready') : t('Database not loaded')}
        </Badge>
      </div>
      <div className='text-muted-foreground flex flex-wrap gap-x-4 gap-y-1'>
        <span>
          {t('Data built at')}: {formatDate(db?.built_at)}
        </span>
        <span>
          {t('Last updated')}: {formatDate(db?.updated_at)}
        </span>
        <span>{formatSize(db?.size)}</span>
      </div>
      {db?.error ? (
        <span className='text-destructive'>{db.error}</span>
      ) : null}
    </div>
  )

  return (
    <SettingsSection title={t('IP Geolocation')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}>
          <SettingsPageFormActions
            onSave={form.handleSubmit((values) => saveMutation.mutate(values))}
            isSaving={saveMutation.isPending}
          />

          <FormDescription>
            {t(
              'Offline IP geolocation database used by the IP analysis page. Updating downloads the data file and applies it immediately, no restart needed.'
            )}
          </FormDescription>

          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable IP geolocation')}</FormLabel>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <FormField
            control={form.control}
            name='url_v4'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Database URL (IPv4)')}</FormLabel>
                <FormControl>
                  <Input {...field} className='font-mono text-xs' />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='url_v6'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Database URL (IPv6)')}</FormLabel>
                <FormControl>
                  <Input {...field} className='font-mono text-xs' />
                </FormControl>
              </FormItem>
            )}
          />

          <div className='flex flex-wrap items-center gap-3'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? (
                <Loader2 className='animate-spin' aria-hidden='true' />
              ) : (
                <RefreshCw aria-hidden='true' />
              )}
              {t('Update now')}
            </Button>
            {status?.last_error ? (
              <span className='text-destructive text-xs'>
                {status.last_error}
              </span>
            ) : null}
          </div>

          <div className='grid gap-2 sm:grid-cols-2'>
            {renderDb('IPv4', status?.v4)}
            {renderDb('IPv6', status?.v6)}
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
