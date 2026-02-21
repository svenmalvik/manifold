import React, { useState, useEffect, useCallback } from 'react'

interface PRPanelProps {
  branchName: string
  diff: string
  onAiGenerate: (prompt: string) => Promise<string>
  onGetCommitLog: () => Promise<string>
  onCreatePR: (title: string, body: string) => Promise<string>
  onClose: () => void
  baseBranch: string
}

export function PRPanel({
  branchName,
  diff,
  onAiGenerate,
  onGetCommitLog,
  onCreatePR,
  onClose,
  baseBranch,
}: PRPanelProps): React.JSX.Element {
  const [title, setTitle] = useState(formatBranchAsTitle(branchName))
  const [description, setDescription] = useState('')
  const [generatingTitle, setGeneratingTitle] = useState(false)
  const [generatingDesc, setGeneratingDesc] = useState(false)
  const [creating, setCreating] = useState(false)
  const [prUrl, setPrUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Generate AI title and description on mount
  useEffect(() => {
    let cancelled = false

    void (async () => {
      const commitLog = await onGetCommitLog()

      // Generate title
      if (!cancelled) {
        setGeneratingTitle(true)
        const titlePrompt = `Write a short pull request title (\u226460 chars, imperative mood) for a branch called '${branchName}' with these commits:\n${commitLog}\nOutput only the title, nothing else.`
        const titleResult = await onAiGenerate(titlePrompt)
        if (!cancelled && titleResult) setTitle(titleResult)
        if (!cancelled) setGeneratingTitle(false)
      }

      // Generate description
      if (!cancelled) {
        setGeneratingDesc(true)
        const diffSummary = diff.substring(0, 4000)
        const descPrompt = `Write a pull request description in markdown. Include a brief summary and a bullet-point list of changes. Base it on these commits and diff summary:\n\nCommits:\n${commitLog}\n\nDiff summary:\n${diffSummary}\n\nOutput only the markdown, nothing else.`
        const descResult = await onAiGenerate(descPrompt)
        if (!cancelled && descResult) setDescription(descResult)
        if (!cancelled) setGeneratingDesc(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [branchName, diff, onAiGenerate, onGetCommitLog])

  const handleCreate = useCallback(async () => {
    if (!title.trim()) return
    setCreating(true)
    setError(null)
    try {
      const url = await onCreatePR(title.trim(), description.trim())
      setPrUrl(url)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }, [title, description, onCreatePR])

  if (prUrl) {
    return (
      <div style={styles.panel}>
        <div style={styles.header}>
          <span style={styles.title}>Pull Request Created</span>
          <button style={styles.closeButton} onClick={onClose} title="Close">
            {'\u00D7'}
          </button>
        </div>
        <div style={styles.successContent}>
          <div style={styles.successMessage}>PR created successfully!</div>
          <a
            style={styles.prLink}
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault()
              void window.electronAPI.invoke('shell:create', '').catch(() => {})
              window.open(prUrl, '_blank')
            }}
          >
            {prUrl}
          </a>
          <button style={styles.doneButton} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>Create Pull Request</span>
        <button style={styles.closeButton} onClick={onClose} title="Close">
          {'\u00D7'}
        </button>
      </div>

      <div style={styles.form}>
        <div style={styles.fieldGroup}>
          <label style={styles.label}>Title</label>
          <input
            style={styles.input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={generatingTitle ? 'Generating title\u2026' : 'PR title'}
            disabled={creating}
          />
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.label}>Description</label>
          <textarea
            style={styles.textarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={generatingDesc ? 'Generating description\u2026' : 'PR description (markdown)'}
            disabled={creating}
            rows={10}
          />
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.label}>Base branch</label>
          <span className="mono" style={styles.readOnly}>
            {baseBranch}
          </span>
        </div>

        {error && <div style={styles.error}>{error}</div>}
      </div>

      <div style={styles.actions}>
        <button style={styles.cancelButton} onClick={onClose} disabled={creating}>
          Cancel
        </button>
        <button
          style={styles.createButton}
          onClick={() => void handleCreate()}
          disabled={creating || !title.trim()}
        >
          {creating ? 'Creating\u2026' : 'Push & Create PR'}
        </button>
      </div>
    </div>
  )
}

function formatBranchAsTitle(branch: string): string {
  // manifold/oslo -> Oslo
  const name = branch.replace(/^manifold\//, '')
  return name.charAt(0).toUpperCase() + name.slice(1)
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
  form: {
    flex: 1,
    overflow: 'auto',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  label: {
    fontSize: '10px',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  input: {
    padding: '6px 8px',
    fontSize: '12px',
    fontFamily: 'var(--font-mono)',
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    boxSizing: 'border-box' as const,
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
  readOnly: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    padding: '6px 0',
  },
  error: {
    fontSize: '11px',
    color: 'var(--error, #f44)',
    padding: '4px 0',
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
  createButton: {
    padding: '4px 12px',
    fontSize: '11px',
    fontWeight: 600,
    color: '#fff',
    background: 'var(--accent)',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  successContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '24px',
  },
  successMessage: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  prLink: {
    fontSize: '12px',
    color: 'var(--accent)',
    wordBreak: 'break-all' as const,
    textAlign: 'center' as const,
  },
  doneButton: {
    padding: '6px 16px',
    fontSize: '12px',
    fontWeight: 600,
    color: '#fff',
    background: 'var(--accent)',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    marginTop: '8px',
  },
}
