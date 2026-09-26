import { describe, expect, it } from 'vitest'

import {
  buildOIDCOAuthUrl,
  buildOAuthAuthorizationUrl,
  type OAuthPKCEParams,
} from './oauth'
import type { SystemStatus } from '@/features/auth/types'

const pkce: OAuthPKCEParams = { challenge: 'challenge-abc', method: 'S256' }

describe('oauth url builders carry the client-side PKCE challenge', () => {
  it('adds code_challenge and the S256 method to the OIDC authorize URL', () => {
    const url = new URL(
      buildOIDCOAuthUrl(
        'https://idp.example.com/oauth/authorize',
        'client-1',
        'state-1',
        pkce
      )
    )
    expect(url.searchParams.get('code_challenge')).toBe('challenge-abc')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe('state-1')
  })

  it('leaves the OIDC URL untouched when the server issued no challenge', () => {
    const url = new URL(
      buildOIDCOAuthUrl(
        'https://idp.example.com/oauth/authorize',
        'client-1',
        'state-1'
      )
    )
    expect(url.searchParams.has('code_challenge')).toBe(false)
  })

  it('adds the challenge for custom providers as well', () => {
    const status = {
      custom_oauth_providers: [
        {
          slug: 'muw-api',
          name: 'muw-api',
          client_id: 'client-2',
          authorization_endpoint: 'https://idp.example.com/oauth/authorize',
          scopes: 'openid profile email',
        },
      ],
    } as unknown as SystemStatus

    const url = new URL(
      buildOAuthAuthorizationUrl('muw-api', 'state-2', status, {
        challenge: 'challenge-xyz',
      })
    )
    expect(url.searchParams.get('client_id')).toBe('client-2')
    expect(url.searchParams.get('code_challenge')).toBe('challenge-xyz')
    // 未显式给 method 时按 S256 兜底
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })
})
