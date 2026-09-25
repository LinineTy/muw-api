// @muw-owned
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'

import { submitApplication } from '../api'
import { OAUTH_QUERY_KEY } from '../constants'
import { SCOPE_LABELS, SUPPORTED_SCOPES } from '../scopes'

const CLIENT_TYPE_OPTIONS = [
  {
    value: 'public',
    label: 'Public client (no secret, uses PKCE)',
  },
  {
    value: 'confidential',
    label: 'Confidential client (server side, with a secret)',
  },
] as const

export function ApplyApplicationDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [redirectUris, setRedirectUris] = useState('')
  const [scopes, setScopes] = useState<string[]>(['openid', 'profile'])
  const [clientType, setClientType] = useState('public')
  const [reason, setReason] = useState('')

  const mutation = useMutation({
    mutationFn: submitApplication,
    onSuccess: async () => {
      toast.success(t('Application submitted, waiting for review'))
      setName('')
      setDescription('')
      setRedirectUris('')
      setScopes(['openid', 'profile'])
      setClientType('public')
      setReason('')
      props.onOpenChange(false)
      await queryClient.invalidateQueries({ queryKey: OAUTH_QUERY_KEY })
    },
  })

  const submit = () => {
    mutation.mutate({
      name,
      description,
      redirect_uris: redirectUris
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      scopes,
      client_type: clientType,
      apply_reason: reason,
    })
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Apply for a new application')}
      description={t(
        'Applications stay unusable until an administrator approves them.'
      )}
      footer={
        <>
          <Button
            variant='outline'
            onClick={() => props.onOpenChange(false)}
            disabled={mutation.isPending}
          >
            {t('Cancel')}
          </Button>
          <Button
            onClick={submit}
            disabled={mutation.isPending || !name || !redirectUris}
          >
            {t('Submit application')}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-3'>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='oauth-apply-name'>{t('Application name')}</Label>
          <Input
            id='oauth-apply-name'
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='oauth-apply-description'>{t('Description')}</Label>
          <Input
            id='oauth-apply-description'
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='oauth-apply-redirects'>
            {t('Redirect URIs, one per line')}
          </Label>
          <Textarea
            id='oauth-apply-redirects'
            rows={3}
            placeholder='https://app.example.com/callback'
            value={redirectUris}
            onChange={(event) => setRedirectUris(event.target.value)}
          />
        </div>
        <div className='flex flex-col gap-2'>
          <Label>{t('Application type')}</Label>
          <RadioGroup
            value={clientType}
            onValueChange={(value) => setClientType(value as string)}
            className='gap-2'
          >
            {CLIENT_TYPE_OPTIONS.map((option) => (
              <Label
                key={option.value}
                htmlFor={`oauth-client-type-${option.value}`}
                className='flex items-center gap-2 text-sm font-normal'
              >
                <RadioGroupItem
                  id={`oauth-client-type-${option.value}`}
                  value={option.value}
                />
                {t(option.label)}
              </Label>
            ))}
          </RadioGroup>
        </div>
        <div className='flex flex-col gap-2'>
          <Label>{t('Requested scopes')}</Label>
          {SUPPORTED_SCOPES.map((scope) => (
            <Label
              key={scope}
              htmlFor={`oauth-apply-scope-${scope}`}
              className='flex items-center gap-2 text-sm font-normal'
            >
              <Checkbox
                id={`oauth-apply-scope-${scope}`}
                checked={scopes.includes(scope)}
                disabled={scope === 'openid'}
                onCheckedChange={(checked) =>
                  setScopes((current) =>
                    checked === true
                      ? Array.from(new Set([...current, scope]))
                      : current.filter((item) => item !== scope)
                  )
                }
              />
              {t(SCOPE_LABELS[scope])}
            </Label>
          ))}
        </div>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='oauth-apply-reason'>
            {t('Reason for the request')}
          </Label>
          <Textarea
            id='oauth-apply-reason'
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </div>
    </Dialog>
  )
}
