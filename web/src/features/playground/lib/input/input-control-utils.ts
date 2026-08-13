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
import type { GroupOption, ModelOption } from '../../types'

type InputControlStateOptions = {
  disabled?: boolean
  groups: GroupOption[]
  hasStopHandler: boolean
  isGenerating?: boolean
  isModelLoading?: boolean
  models: ModelOption[]
  text: string
  hasFiles?: boolean
}

type InputControlState = {
  canSubmit: boolean
  isSelectorDisabled: boolean
  shouldShowStop: boolean
}

// FileUIPart 的形状（prompt-input 的附件部件，url 在提交前已转成 data URL）。
type InputFilePart = {
  type?: string
  url?: string
  data?: string
  mediaType?: string
  filename?: string
  file?: File
}

type SubmittableInputMessage = {
  text?: string | null
  files?: InputFilePart[]
}

type SubmittableInput = {
  text: string
  files: File[]
}

function dataUrlToFile(
  dataUrl: string,
  filename: string,
  mediaType?: string
): File {
  const [meta, base64] = dataUrl.split(',')
  const mime =
    mediaType ||
    meta?.match(/^data:([^;,]+)/)?.[1] ||
    'application/octet-stream'
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new File([bytes], filename, { type: mime })
}

function partToFile(part: InputFilePart): File | null {
  if (part.file) {
    return part.file
  }
  const source = part.url || part.data
  if (!source) {
    return null
  }
  try {
    return dataUrlToFile(source, part.filename || 'image', part.mediaType)
  } catch {
    return null
  }
}

/**
 * Extract submittable text + image files from a PromptInput message. Allows
 * image-only messages (no text). Files are converted from data URLs back to
 * File objects so the caller can upload them.
 */
export function getSubmittableInputMessage(
  message: SubmittableInputMessage,
  disabled?: boolean
): SubmittableInput | null {
  if (disabled) {
    return null
  }

  const text = message.text?.trim() ?? ''
  const files = (message.files ?? [])
    .filter((part) => part.type === 'file')
    .map(partToFile)
    .filter((file): file is File => file !== null)

  if (!text && files.length === 0) {
    return null
  }

  return { text, files }
}

export function getInputControlState({
  disabled,
  groups,
  hasStopHandler,
  isGenerating,
  isModelLoading,
  text,
  hasFiles = false,
}: InputControlStateOptions): InputControlState {
  return {
    // 不依赖 hasModels：模型列表为空时按钮也应能亮，让用户可发送并在后端得到明确报错。
    canSubmit:
      !disabled && (text.trim().length > 0 || hasFiles),
    isSelectorDisabled: disabled || isModelLoading || groups.length === 0,
    shouldShowStop: Boolean(isGenerating && hasStopHandler),
  }
}
