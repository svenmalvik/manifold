import type { CSSProperties } from 'react'

export const container: CSSProperties = {
  padding: 40,
  maxWidth: 960,
  margin: '0 auto',
}

export const createSection: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: 24,
  marginBottom: 40,
}

export const createTitle: CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  marginBottom: 12,
}

export const techStackRow: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  marginBottom: 20,
  fontSize: 13,
  lineHeight: 1.6,
  color: 'var(--text-muted)',
}

export const techItem: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
}

export const techDot: CSSProperties = {
  opacity: 0.4,
}

export const formRow: CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'flex-end',
}

export const fieldGroup: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
}

export const fieldLabel: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-muted)',
  marginBottom: 6,
}

export const input: CSSProperties = {
  padding: '10px 14px',
  fontSize: 14,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  color: 'var(--text)',
  outline: 'none',
  width: 200,
}

export const descriptionInput: CSSProperties = {
  padding: '10px 14px',
  fontSize: 14,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  color: 'var(--text)',
  outline: 'none',
  flex: 1,
}

export const startButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: 'var(--radius)',
  padding: '10px 24px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
}

export const sectionTitle: CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  marginBottom: 20,
  color: 'var(--text-muted)',
}

export const grid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 20,
}
