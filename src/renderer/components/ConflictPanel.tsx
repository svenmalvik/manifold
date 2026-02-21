import React, { useState, useCallback } from 'react'
import type { ConflictFileStatus } from '../../shared/types'

interface ConflictPanelProps {
  conflicts: ConflictFileStatus[]
  sessionId: string
  onAiGenerate: (prompt: string) => Promise<string>
  onResolveConflict: (filePath: string, resolvedContent: string) => Promise<void>
  onCompleteMerge: () => Promise<void>
  onViewFile: (filePath: string) => void
  onClose: () => void
}

type ResolutionState = 'idle' | 'resolving' | 'resolved' | 'error'

interface FileResolution {
  state: ResolutionState
  proposed?: string
}

export function ConflictPanel({
  conflicts,
  sessionId,
  onAiGenerate,
  onResolveConflict,
  onCompleteMerge,
  onViewFile,
  onClose,
}: ConflictPanelProps): React.JSX.Element {
  const [resolutions, setResolutions] = useState<Record<string, FileResolution>>({})
  const [completing, setCompleting] = useState(false)

  const handleResolveWithAI = useCallback(
    async (filePath: string) => {
      setResolutions((prev) => ({
        ...prev,
        [filePath]: { state: 'resolving' },
      }))

      try {
        // Read the conflicted file content
        const content = (await window.electronAPI.invoke(
          'files:read',
          sessionId,
          filePath
        )) as string

        const prompt = `You are resolving a git merge conflict. The file below contains conflict markers. Output only the fully resolved file content with all conflict markers removed, choosing the best resolution. Do not explain.\n\n${content}`

        const resolved = await onAiGenerate(prompt)

        if (resolved) {
          await onResolveConflict(filePath, resolved)
          setResolutions((prev) => ({
            ...prev,
            [filePath]: { state: 'resolved', proposed: resolved },
          }))
        } else {
          // AI failed — open file for manual editing
          onViewFile(filePath)
          setResolutions((prev) => ({
            ...prev,
            [filePath]: { state: 'error' },
          }))
        }
      } catch {
        onViewFile(filePath)
        setResolutions((prev) => ({
          ...prev,
          [filePath]: { state: 'error' },
        }))
      }
    },
    [sessionId, onAiGenerate, onResolveConflict, onViewFile]
  )

  const allResolved = conflicts.length > 0 && conflicts.every(
    (c) => resolutions[c.path]?.state === 'resolved'
  )

  const handleCompleteMerge = useCallback(async () => {
    setCompleting(true)
    try {
      await onCompleteMerge()
      onClose()
    } catch {
      setCompleting(false)
    }
  }, [onCompleteMerge, onClose])

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>Conflicts</span>
        <button style={styles.closeButton} onClick={onClose} title="Close">
          {'\u00D7'}
        </button>
      </div>

      <div style={styles.fileList}>
        {conflicts.map((conflict) => {
          const res = resolutions[conflict.path]
          return (
            <div key={conflict.path} style={styles.fileRow}>
              <div style={styles.fileInfo}>
                <span style={styles.conflictBadge}>{conflict.status}</span>
                <span className="mono" style={styles.filePath}>
                  {conflict.path}
                </span>
              </div>
              <div style={styles.fileActions}>
                {res?.state === 'resolved' ? (
                  <span style={styles.resolvedLabel}>Resolved</span>
                ) : res?.state === 'resolving' ? (
                  <span style={styles.resolvingLabel}>Resolving...</span>
                ) : (
                  <>
                    <button
                      style={styles.actionButton}
                      onClick={() => onViewFile(conflict.path)}
                    >
                      View
                    </button>
                    <button
                      style={styles.actionButton}
                      onClick={() => void handleResolveWithAI(conflict.path)}
                    >
                      Resolve with AI
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {allResolved && (
        <div style={styles.actions}>
          <button
            style={styles.mergeButton}
            onClick={() => void handleCompleteMerge()}
            disabled={completing}
          >
            {completing ? 'Completing\u2026' : 'Complete Merge'}
          </button>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--bg-primary)',
    borderLeft: '1px solid var(--border)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-secondary)',
    flexShrink: 0,
  },
  title: {
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--text-primary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  closeButton: {
    fontSize: '16px',
    lineHeight: 1,
    color: 'var(--text-muted)',
    cursor: 'pointer',
    padding: '0 4px',
  },
  fileList: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '8px 12px',
  },
  fileRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 0',
    borderBottom: '1px solid var(--border)',
    gap: '8px',
  },
  fileInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    overflow: 'hidden',
    minWidth: 0,
  },
  conflictBadge: {
    fontSize: '9px',
    fontWeight: 700,
    fontFamily: 'var(--font-mono)',
    padding: '1px 4px',
    borderRadius: '2px',
    background: 'rgba(255, 152, 0, 0.2)',
    color: '#ff9800',
    flexShrink: 0,
  },
  filePath: {
    fontSize: '11px',
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  fileActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flexShrink: 0,
  },
  actionButton: {
    padding: '2px 8px',
    fontSize: '10px',
    color: 'var(--accent)',
    background: 'rgba(79, 195, 247, 0.12)',
    border: 'none',
    borderRadius: '3px',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  resolvedLabel: {
    fontSize: '10px',
    fontWeight: 600,
    color: 'var(--success, #4caf50)',
  },
  resolvingLabel: {
    fontSize: '10px',
    color: 'var(--text-muted)',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    padding: '8px 12px',
    borderTop: '1px solid var(--border)',
    flexShrink: 0,
  },
  mergeButton: {
    padding: '6px 16px',
    fontSize: '11px',
    fontWeight: 600,
    color: '#fff',
    background: 'var(--accent)',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
}
