import { useState, useEffect, useCallback } from 'react'
import type { AheadBehind, ConflictFileStatus } from '../../shared/types'

export interface UseGitOpsResult {
  conflicts: ConflictFileStatus[]
  aheadBehind: AheadBehind
  committing: boolean
  generating: boolean
  commit: (message: string) => Promise<void>
  aiGenerate: (prompt: string) => Promise<string>
  resolveConflict: (filePath: string, resolvedContent: string) => Promise<void>
  completeMerge: () => Promise<void>
  refreshAheadBehind: () => Promise<void>
  getCommitLog: () => Promise<string>
}

export function useGitOps(sessionId: string | null): UseGitOpsResult {
  const [conflicts, setConflicts] = useState<ConflictFileStatus[]>([])
  const [aheadBehind, setAheadBehind] = useState<AheadBehind>({ ahead: 0, behind: 0 })
  const [committing, setCommitting] = useState(false)
  const [generating, setGenerating] = useState(false)

  // Listen for conflict events from the main process
  useEffect(() => {
    const unsub = window.electronAPI.on(
      'agent:conflicts',
      (payload: unknown) => {
        const data = payload as { sessionId: string; conflicts: ConflictFileStatus[] }
        if (data.sessionId === sessionId) {
          setConflicts(data.conflicts)
        }
      }
    )
    return unsub
  }, [sessionId])

  // Reset state on session change
  useEffect(() => {
    setConflicts([])
    setAheadBehind({ ahead: 0, behind: 0 })
  }, [sessionId])

  const refreshAheadBehind = useCallback(async (): Promise<void> => {
    if (!sessionId) return
    try {
      const result = (await window.electronAPI.invoke('git:ahead-behind', {
        sessionId,
      })) as AheadBehind
      setAheadBehind(result)
    } catch {
      // Ignore errors — branch may not exist yet
    }
  }, [sessionId])

  // Poll ahead/behind on session change
  useEffect(() => {
    void refreshAheadBehind()
  }, [refreshAheadBehind])

  const commit = useCallback(
    async (message: string): Promise<void> => {
      if (!sessionId) return
      setCommitting(true)
      try {
        await window.electronAPI.invoke('git:commit', { sessionId, message })
        await refreshAheadBehind()
      } finally {
        setCommitting(false)
      }
    },
    [sessionId, refreshAheadBehind]
  )

  const aiGenerate = useCallback(
    async (prompt: string): Promise<string> => {
      if (!sessionId) return ''
      setGenerating(true)
      try {
        const result = (await window.electronAPI.invoke('git:ai-generate', {
          sessionId,
          prompt,
        })) as string
        return result
      } catch {
        return ''
      } finally {
        setGenerating(false)
      }
    },
    [sessionId]
  )

  const resolveConflict = useCallback(
    async (filePath: string, resolvedContent: string): Promise<void> => {
      if (!sessionId) return
      await window.electronAPI.invoke('git:resolve-conflict', {
        sessionId,
        filePath,
        resolvedContent,
      })
    },
    [sessionId]
  )

  const completeMerge = useCallback(async (): Promise<void> => {
    if (!sessionId) return
    await window.electronAPI.invoke('git:complete-merge', { sessionId })
  }, [sessionId])

  const getCommitLog = useCallback(async (): Promise<string> => {
    if (!sessionId) return ''
    try {
      return (await window.electronAPI.invoke('git:commit-log', { sessionId })) as string
    } catch {
      return ''
    }
  }, [sessionId])

  return {
    conflicts,
    aheadBehind,
    committing,
    generating,
    commit,
    aiGenerate,
    resolveConflict,
    completeMerge,
    refreshAheadBehind,
    getCommitLog,
  }
}
