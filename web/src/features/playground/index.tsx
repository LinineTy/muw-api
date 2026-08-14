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
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { downloadBlob } from '@/lib/download'

import { uploadPlaygroundImage } from './api'
import { MAX_IMAGE_UPLOAD_BYTES } from './constants'
import {
  useChatHandler,
  usePlaygroundConversation,
  usePlaygroundOptions,
  usePlaygroundState,
} from './hooks'
import {
  buildConversationExport,
  createUserMessage,
  deriveConversationTitle,
  getMessageContent,
} from './lib'
import type { ConversationExportFormat } from './lib/export/conversation-export'
import type { PlaygroundMode } from './types'
import { PlaygroundChat } from './components/chat/playground-chat'
import { PlaygroundConversationBar } from './components/chat/playground-conversation-bar'
import { PlaygroundSystemPromptDialog } from './components/chat/playground-system-prompt-dialog'
import { PlaygroundImageGeneration } from './components/image/playground-image-generation'
import { PlaygroundInput } from './components/input/playground-input'

export function Playground() {
  const { t } = useTranslation()
  const {
    config,
    parameterEnabled,
    messages,
    isLoadingMessages,
    models,
    groups,
    conversations,
    activeConversationId,
    activeConversation,
    updateMessages,
    setModels,
    setGroups,
    updateConfig,
    updateParameterEnabled,
    clearMessages,
    createConversation,
    switchConversation,
    renameConversation,
    deleteConversation,
    applySystemMessage,
    clearSystemMessage,
  } = usePlaygroundState()

  const [mode, setMode] = useState<PlaygroundMode>('chat')
  const [systemPromptOpen, setSystemPromptOpen] = useState(false)
  const uploadingRef = useRef(false)

  const { sendChat, stopGeneration, isGenerating } = useChatHandler({
    config,
    parameterEnabled,
    onMessageUpdate: updateMessages,
  })

  const {
    editingMessageKey,
    handleSendMessage,
    handleRegenerateMessage,
    handleEditMessage,
    handleEditOpenChange,
    applyEdit,
    handleDeleteMessage,
  } = usePlaygroundConversation({
    messages,
    updateMessages,
    sendChat,
  })

  const handleClearMessages = () => {
    handleEditOpenChange(false)
    clearMessages()
  }

  // 新会话发出第一条用户消息时自动用该消息生成标题（手动改名后不再覆盖）。
  const handleSendMessageWithTitle = useCallback(
    (text: string, attachments?: string[]) => {
      const hasUserContent = (activeConversation?.messages ?? []).some(
        (message) =>
          message.from === 'user' && getMessageContent(message).trim() !== ''
      )
      if (activeConversation && !hasUserContent) {
        const title = deriveConversationTitle(
          [createUserMessage(text)],
          t('New chat')
        )
        if (title) {
          renameConversation(activeConversation.id, title)
        }
      }
      handleSendMessage(text, attachments)
    },
    [activeConversation, handleSendMessage, renameConversation, t]
  )

  const { isLoadingModels } = usePlaygroundOptions({
    currentGroup: config.group,
    currentModel: config.model,
    setGroups,
    setModels,
    updateConfig,
  })

  const onUploadFiles = useCallback(
    async (files: File[]): Promise<string[]> => {
      if (uploadingRef.current) {
        return []
      }
      uploadingRef.current = true
      try {
        const urls: string[] = []
        for (const file of files) {
          if (!file.type.startsWith('image/')) {
            toast.error(t('Only image files are supported'))
            continue
          }
          if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
            toast.error(t('Image too large (max 5MB)'))
            continue
          }
          try {
            const { url } = await uploadPlaygroundImage(file)
            urls.push(url)
          } catch {
            toast.error(t('Upload failed'))
          }
        }
        return urls
      } finally {
        uploadingRef.current = false
      }
    },
    [t]
  )

  const handleExport = useCallback(
    (format: ConversationExportFormat) => {
      if (!activeConversation || activeConversation.messages.length === 0) {
        toast.info(t('Nothing to export yet'))
        return
      }
      const { content, filename, mimeType } = buildConversationExport(
        format,
        activeConversation.title || t('New chat'),
        activeConversation.messages,
        config
      )
      downloadBlob(content, filename, mimeType)
      toast.success(t('Conversation exported'))
    },
    [activeConversation, config, t]
  )

  const activeTitle = activeConversation?.title ?? t('New chat')
  const systemPromptContent = useCallback(() => {
    const systemMessage = (activeConversation?.messages ?? []).find(
      (message) => message.from === 'system'
    )
    return systemMessage ? getMessageContent(systemMessage) : ''
  }, [activeConversation])

  return (
    <div className='relative flex size-full min-h-0 flex-col overflow-hidden'>
      <PlaygroundConversationBar
        activeConversationId={activeConversationId}
        activeTitle={activeTitle}
        conversations={conversations}
        disabled={isGenerating}
        mode={mode}
        onCreate={createConversation}
        onDelete={deleteConversation}
        onExport={handleExport}
        onModeChange={setMode}
        onOpenSystemPrompt={() => setSystemPromptOpen(true)}
        onRename={renameConversation}
        onSwitch={switchConversation}
      />

      {/* chat 与 image 两个模式都保持挂载，仅用 CSS 隐藏未激活的：切换 tab 不卸载
          子树，输入框草稿与绘图历史跨切换保留（display:contents 让 chat 的
          flex-1 滚动布局照常参与父容器布局）。 */}
      <div className={mode === 'chat' ? 'contents' : 'hidden'}>
        {/* Full-width scroll container: scrolling works even over side whitespace */}
        <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
          <PlaygroundChat
            messages={messages}
            isLoadingMessages={isLoadingMessages}
            onRegenerateMessage={handleRegenerateMessage}
            onEditMessage={handleEditMessage}
            onDeleteMessage={handleDeleteMessage}
            onSelectPrompt={handleSendMessageWithTitle}
            isGenerating={isGenerating}
            editingKey={editingMessageKey}
            onCancelEdit={handleEditOpenChange}
            onSaveEdit={(newContent) => applyEdit(newContent, false)}
            onSaveEditAndSubmit={(newContent) => applyEdit(newContent, true)}
          />
        </div>

        {/* Input area: center content and constrain to the same container width */}
        <div className='mx-auto w-full max-w-4xl'>
          <PlaygroundInput
            config={config}
            disabled={isGenerating}
            groups={groups}
            groupValue={config.group}
            isGenerating={isGenerating}
            isModelLoading={isLoadingModels}
            modelValue={config.model}
            models={models}
            onGroupChange={(value) => updateConfig('group', value)}
            onConfigChange={updateConfig}
            onClearMessages={handleClearMessages}
            onModelChange={(value) => updateConfig('model', value)}
            onParameterEnabledChange={updateParameterEnabled}
            onStop={stopGeneration}
            onSubmit={handleSendMessageWithTitle}
            onUploadFiles={onUploadFiles}
            parameterEnabled={parameterEnabled}
            hasMessages={messages.length > 0}
          />
        </div>
      </div>
      <div className={mode === 'chat' ? 'hidden' : ''}>
        <PlaygroundImageGeneration group={config.group} models={models} />
      </div>

      <PlaygroundSystemPromptDialog
        initialContent={systemPromptContent()}
        onApply={applySystemMessage}
        onClear={clearSystemMessage}
        onOpenChange={setSystemPromptOpen}
        open={systemPromptOpen}
      />
    </div>
  )
}
