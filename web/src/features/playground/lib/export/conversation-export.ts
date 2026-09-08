// @muw-owned
import type { Message, PlaygroundConfig } from '../../types'
import { getCurrentVersion } from '../message/message-utils'

export type ConversationExportFormat = 'markdown' | 'json' | 'text'

const ROLE_LABELS: Record<string, string> = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role
}

function formatExportDate(): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date())
}

function buildMarkdownExport(
  title: string,
  messages: Message[],
  config: PlaygroundConfig
): string {
  const lines: string[] = [`# ${title}`, '']
  lines.push(`> ${formatExportDate()} · ${config.model}`)
  lines.push('')

  for (const message of messages) {
    const content = getCurrentVersion(message).content
    lines.push(`## ${roleLabel(message.from)}`, '')
    if (message.attachments?.length) {
      for (const url of message.attachments) {
        lines.push(`![image](${url})`, '')
      }
    }
    if (content) {
      lines.push(content, '')
    }
    if (message.usage) {
      lines.push(
        `> Tokens: ${message.usage.promptTokens} prompt · ${message.usage.completionTokens} completion · ${message.usage.totalTokens} total`,
        ''
      )
    }
  }

  return `${lines.join('\n').trimEnd()}\n`
}

function buildJsonExport(
  title: string,
  messages: Message[],
  config: PlaygroundConfig
): string {
  return `${JSON.stringify(
    {
      title,
      exportedAt: new Date().toISOString(),
      model: config.model,
      group: config.group,
      messages: messages.map((message) => ({
        role: message.from,
        content: getCurrentVersion(message).content,
        attachments: message.attachments,
        usage: message.usage,
      })),
    },
    null,
    2
  )}\n`
}

function buildTextExport(
  title: string,
  messages: Message[],
  config: PlaygroundConfig
): string {
  const lines: string[] = [title, `${formatExportDate()} · ${config.model}`, '']

  for (const message of messages) {
    const content = getCurrentVersion(message).content
    const attachments = message.attachments?.map((url) => `[image] ${url}`)
    const body = [content, ...(attachments ?? [])].filter(Boolean).join('\n')
    lines.push(`${roleLabel(message.from)}:`, body, '')
  }

  return `${lines.join('\n').trimEnd()}\n`
}

/**
 * Strip characters that are unsafe in file names on common OSes.
 */
export function sanitizeFilename(title: string): string {
  const cleaned = title.replaceAll(/[\\/:*?"<>|]/g, '').trim()
  return cleaned || 'conversation'
}

function timestampSuffix(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

const FORMAT_META: Record<
  ConversationExportFormat,
  { ext: string; mime: string }
> = {
  markdown: { ext: 'md', mime: 'text/markdown;charset=utf-8' },
  json: { ext: 'json', mime: 'application/json;charset=utf-8' },
  text: { ext: 'txt', mime: 'text/plain;charset=utf-8' },
}

/**
 * Build the export payload for the given format.
 */
export function buildConversationExport(
  format: ConversationExportFormat,
  title: string,
  messages: Message[],
  config: PlaygroundConfig
): { filename: string; content: string; mimeType: string } {
  const meta = FORMAT_META[format]

  let content: string
  if (format === 'markdown') {
    content = buildMarkdownExport(title, messages, config)
  } else if (format === 'json') {
    content = buildJsonExport(title, messages, config)
  } else {
    content = buildTextExport(title, messages, config)
  }

  return {
    filename: `${sanitizeFilename(title)}-${timestampSuffix()}.${meta.ext}`,
    content,
    mimeType: meta.mime,
  }
}
