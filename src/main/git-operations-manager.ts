import { spawn } from 'node:child_process'
import { writeFile as writeFileAsync } from 'node:fs/promises'
import { join } from 'node:path'
import type { AheadBehind, GitStatusDetail, ConflictFileStatus } from '../shared/types'

function gitExec(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []

    child.stdout!.on('data', (data: Buffer) => chunks.push(data))
    child.stderr!.on('data', (data: Buffer) => errChunks.push(data))

    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString('utf8')
        reject(new Error(`git ${args[0]} failed (code ${code}): ${stderr}`))
      } else {
        resolve(Buffer.concat(chunks).toString('utf8'))
      }
    })
  })
}

function execCommand(
  binary: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const chunks: Buffer[] = []
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
      resolve('')
    }, timeoutMs)

    child.stdout!.on('data', (data: Buffer) => chunks.push(data))

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', () => {
      clearTimeout(timer)
      if (timedOut) return
      resolve(Buffer.concat(chunks).toString('utf8').trim())
    })
  })
}

const AI_TIMEOUT_MS = 15_000

export class GitOperationsManager {
  async commit(worktreePath: string, message: string): Promise<void> {
    await gitExec(['add', '.'], worktreePath)
    await gitExec(['commit', '-m', message], worktreePath)
  }

  async getStatusDetail(worktreePath: string): Promise<GitStatusDetail> {
    const raw = await gitExec(['status', '--porcelain'], worktreePath)
    const conflicts: ConflictFileStatus[] = []
    const staged: string[] = []
    const unstaged: string[] = []

    for (const line of raw.split('\n')) {
      if (line.length < 4) continue
      const xy = line.substring(0, 2)
      const filePath = line.substring(3)

      if (xy === 'UU' || xy === 'AA' || xy === 'DD') {
        conflicts.push({ path: filePath, status: xy as ConflictFileStatus['status'] })
      } else if (xy[0] !== ' ' && xy[0] !== '?') {
        staged.push(filePath)
      } else if (xy[1] !== ' ') {
        unstaged.push(filePath)
      }
    }

    return { conflicts, staged, unstaged }
  }

  async getAheadBehind(worktreePath: string, baseBranch: string): Promise<AheadBehind> {
    try {
      const stdout = await gitExec(
        ['rev-list', '--left-right', '--count', `${baseBranch}...HEAD`],
        worktreePath
      )
      const parts = stdout.trim().split(/\s+/)
      return {
        ahead: parseInt(parts[1] ?? '0', 10) || 0,
        behind: parseInt(parts[0] ?? '0', 10) || 0,
      }
    } catch {
      return { ahead: 0, behind: 0 }
    }
  }

  async resolveConflict(
    worktreePath: string,
    filePath: string,
    resolvedContent: string
  ): Promise<void> {
    const fullPath = join(worktreePath, filePath)
    await writeFileAsync(fullPath, resolvedContent, 'utf-8')
    await gitExec(['add', filePath], worktreePath)
  }

  async completeMerge(worktreePath: string): Promise<void> {
    await gitExec(['commit', '--no-edit'], worktreePath)
  }

  async aiGenerate(runtimeBinary: string, prompt: string, cwd: string): Promise<string> {
    try {
      return await execCommand(runtimeBinary, ['-p', prompt], cwd, AI_TIMEOUT_MS)
    } catch {
      return ''
    }
  }

  async getCommitLog(worktreePath: string, baseBranch: string): Promise<string> {
    try {
      return await gitExec(
        ['log', '--oneline', `${baseBranch}..HEAD`],
        worktreePath
      )
    } catch {
      return ''
    }
  }
}
