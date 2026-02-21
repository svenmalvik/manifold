import React, { useState, useEffect, useCallback } from 'react'
import type { FileChange } from '../../shared/types'

interface CommitPanelProps {
  changedFiles: FileChange[]
  diff: string
  onCommit: (message: string) => Promise<void>
  onAiGenerate: (prompt: string) => Promise<string>
  onClose: () => void
  committing: boolean
}

export function CommitPanel({
  changedFiles,
  diff,
  onCommit,
  onAiGenerate,
  onClose,
  committing,
}: CommitPanelProps): React.JSX.Element {
  const [message, setMessage] = useState('')
  const [generating, setGenerating] = useState(false)

  // Generate AI commit message on mount
  useEffect(() => {
    let cancelled = false
    if (!diff) return

    setGenerating(true)
    const prompt = `Write a concise git commit message (subject line only, imperative mood, \u226472 chars) for the following diff. Output only the message, nothing else.\n\n${diff}`

    void onAiGenerate(prompt).then((result) => {
      if (!cancelled && result) {
        setMessage(result)
      }
      if (!cancelled) setGenerating(false)
    })

    return () => {
      cancelled = true
    }
  }, [diff, onAiGenerate])

  const handleCommit = useCallback(async () => {
    if (!message.trim()) return
    await onCommit(message.trim())
    onClose()
  }, [message, onCommit, onClose])

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>Commit</span>
        <button style={styles.closeButton} onClick={onClose} title="Close">
          {'\u00D7'}
        </button>
      </div>

      <div style={styles.fileList}>
        <div style={styles.sectionLabel}>
          Changed files ({changedFiles.length})
        </div>
        <div style={styles.fileScroller}>
          {changedFiles.map((file) => (
            <div key={file.path} style={styles.fileRow}>
              <span style={styles.fileType} data-type={file.type}>
                {file.type === 'added' ? 'A' : file.type === 'deleted' ? 'D' : 'M'}
              </span>
              <span className="mono" style={styles.filePath}>
                {file.path}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={styles.messageSection}>
        <div style={styles.sectionLabel}>Commit message</div>
        <textarea
          style={styles.textarea}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={generating ? 'Generating message\u2026' : 'Enter commit message'}
          disabled={committing}
          rows={3}
          autoFocus
        />
      </div>

      <div style={styles.actions}>
        <button style={styles.cancelButton} onClick={onClose} disabled={committing}>
          Cancel
        </button>
        <button
          style={styles.commitButton}
          onClick={() => void handleCommit()}
          disabled={committing || !message.trim()}
        >
          {committing ? 'Committing\u2026' : 'Commit'}
        </button>
      </div>
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
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
  sectionLabel: {
    fontSize: '10px',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    padding: '8px 12px 4px',
    flexShrink: 0,
  },
  fileScroller: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '0 12px',
  },
  fileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '2px 0',
    fontSize: '11px',
  },
  fileType: {
    fontSize: '10px',
    fontWeight: 700,
    fontFamily: 'var(--font-mono)',
    width: '14px',
    textAlign: 'center' as const,
    color: 'var(--text-secondary)',
  },
  filePath: {
    fontSize: '11px',
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  messageSection: {
    flexShrink: 0,
    padding: '0 12px 8px',
  },
  textarea: {
    width: '100%',
    padding: '6px 8px',
    fontSize: '12px',
    fontFamily: 'var(--font-mono)',
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    resize: 'vertical' as const,
    boxSizing: 'border-box' as const,
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    padding: '8px 12px',
    borderTop: '1px solid var(--border)',
    flexShrink: 0,
  },
  cancelButton: {
    padding: '4px 12px',
    fontSize: '11px',
    color: 'var(--text-secondary)',
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  commitButton: {
    padding: '4px 12px',
    fontSize: '11px',
    fontWeight: 600,
    color: '#fff',
    background: 'var(--accent)',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
}
