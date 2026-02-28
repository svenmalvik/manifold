import { v4 as uuidv4 } from 'uuid'
import { AgentSession, SpawnAgentOptions } from '../shared/types'
import { getRuntimeById } from './runtimes'
import { WorktreeManager } from './worktree-manager'
import { BranchCheckoutManager } from './branch-checkout-manager'
import { PtyPool } from './pty-pool'
import { ProjectRegistry } from './project-registry'
import { DevServerManager } from './dev-server-manager'
import { writeWorktreeMeta, readWorktreeMeta, removeWorktreeMeta } from './worktree-meta'
import { FileWatcher } from './file-watcher'
import { gitExec } from './git-exec'
import { generateBranchName } from './branch-namer'
import type { ChatAdapter } from './chat-adapter'
import { debugLog } from './debug-log'
import type { BrowserWindow } from 'electron'
import type { InternalSession } from './session-types'
import { SessionStreamWirer } from './session-stream-wirer'
import { SessionDiscovery } from './session-discovery'


export class SessionManager {
  private sessions: Map<string, InternalSession> = new Map()
  private mainWindow: BrowserWindow | null = null
  private chatAdapter: ChatAdapter | null = null
  private streamWirer: SessionStreamWirer
  private devServer: DevServerManager
  private discovery: SessionDiscovery

  constructor(
    private worktreeManager: WorktreeManager,
    private ptyPool: PtyPool,
    private projectRegistry: ProjectRegistry,
    private branchCheckoutManager?: BranchCheckoutManager,
    private fileWatcher?: FileWatcher,
  ) {
    this.streamWirer = new SessionStreamWirer(
      this.ptyPool,
      () => this.chatAdapter,
      this.sendToRenderer.bind(this),
      this.fileWatcher,
      (session) => this.persistAdditionalDirs(session),
      (session) => this.devServer.startDevServer(session),
    )
    this.devServer = new DevServerManager(
      this.ptyPool,
      () => this.chatAdapter,
      this.sessions,
      this.projectRegistry,
      this.sendToRenderer.bind(this),
      this.streamWirer,
    )
    this.discovery = new SessionDiscovery(
      this.sessions,
      this.worktreeManager,
      this.projectRegistry,
      this.fileWatcher,
    )
  }

  setChatAdapter(adapter: ChatAdapter): void {
    this.chatAdapter = adapter
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  private sendToRenderer(channel: string, ...args: unknown[]): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, ...args)
    }
  }

  async createSession(options: SpawnAgentOptions): Promise<AgentSession> {
    const project = this.resolveProject(options.projectId)
    const runtime = this.resolveRuntime(options.runtimeId)

    let worktree: { branch: string; path: string }

    if (options.noWorktree) {
      await this.assertCleanWorkingTree(project.path)

      // Only one no-worktree session per project
      const existingNoWorktree = Array.from(this.sessions.values()).find(
        (s) => s.noWorktree && s.projectId === options.projectId
      )
      if (existingNoWorktree) {
        throw new Error(
          'A no-worktree agent is already running for this project. ' +
          'Only one no-worktree agent can run at a time per project.'
        )
      }

      // No-worktree mode: checkout branch directly in project directory
      if (options.existingBranch) {
        await gitExec(['checkout', options.existingBranch], project.path)
        worktree = { branch: options.existingBranch, path: project.path }
      } else if (options.prIdentifier && this.branchCheckoutManager) {
        const branch = await this.branchCheckoutManager.fetchPRBranch(
          project.path,
          options.prIdentifier
        )
        await gitExec(['checkout', branch], project.path)
        worktree = { branch, path: project.path }
      } else {
        // Create new branch from current HEAD
        const branch = options.branchName ?? (await generateBranchName(project.path, options.prompt ?? ''))
        await gitExec(['checkout', '-b', branch], project.path)
        worktree = { branch, path: project.path }
      }
    } else if (options.prIdentifier && this.branchCheckoutManager) {
      const branch = await this.branchCheckoutManager.fetchPRBranch(
        project.path,
        options.prIdentifier
      )
      worktree = await this.branchCheckoutManager.createWorktreeFromBranch(
        project.path,
        branch,
        project.name
      )
    } else if (options.existingBranch && this.branchCheckoutManager) {
      worktree = await this.branchCheckoutManager.createWorktreeFromBranch(
        project.path,
        options.existingBranch,
        project.name
      )
    } else {
      worktree = await this.worktreeManager.createWorktree(
        project.path,
        project.baseBranch,
        project.name,
        options.branchName,
        options.prompt
      )
    }

    const runtimeArgs = [...(runtime.args ?? [])]
    if (options.ollamaModel) {
      runtimeArgs.push('--model', options.ollamaModel)
    }
    if (options.nonInteractive && options.prompt) {
      // Print mode with streaming JSON: pass the prompt as a CLI argument.
      // --output-format stream-json gives us incremental NDJSON output
      // instead of buffering everything until exit.
      // --verbose is required by Claude Code when using stream-json.
      runtimeArgs.push('-p', options.prompt, '--output-format', 'stream-json', '--verbose')
    }

    debugLog(`[session] nonInteractive=${options.nonInteractive}, runtimeArgs=${JSON.stringify(runtimeArgs)}`)

    const ptyHandle = this.ptyPool.spawn(runtime.binary, runtimeArgs, {
      cwd: worktree.path,
      env: runtime.env,
      cols: options.cols,
      rows: options.rows
    })

    const session = this.buildSession(options, worktree, ptyHandle)
    this.sessions.set(session.id, session)

    if (options.nonInteractive) {
      this.streamWirer.wireStreamJsonOutput(ptyHandle.id, session)
      this.streamWirer.wirePrintModeInitialExitHandling(ptyHandle.id, session)
      this.chatAdapter?.addUserMessage(session.id, options.userMessage || options.prompt)
    } else {
      this.streamWirer.wireOutputStreaming(ptyHandle.id, session)
      this.streamWirer.wireExitHandling(ptyHandle.id, session)
    }

    // Persist runtime and task description so they survive app restarts.
    // Skip for no-worktree sessions — meta files are keyed by worktree path,
    // and writing one next to the project root would pollute the filesystem.
    if (!options.noWorktree) {
      writeWorktreeMeta(worktree.path, {
        runtimeId: options.runtimeId,
        taskDescription: options.prompt || undefined,
        ollamaModel: options.ollamaModel,
      }).catch(() => {})
    }

    return this.toPublicSession(session)
  }

  private async assertCleanWorkingTree(projectPath: string): Promise<void> {
    const status = await gitExec(['status', '--porcelain'], projectPath)
    if (status.trim().length > 0) {
      throw new Error(
        'Cannot switch branches: your working tree has uncommitted changes. ' +
        'Please commit or stash them before starting a no-worktree agent.'
      )
    }
  }

  private resolveProject(projectId: string): { name: string; path: string; baseBranch: string } {
    const project = this.projectRegistry.getProject(projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)
    return project
  }

  private resolveRuntime(runtimeId: string): { binary: string; args?: string[]; env?: Record<string, string> } {
    const runtime = getRuntimeById(runtimeId)
    if (!runtime) throw new Error(`Runtime not found: ${runtimeId}`)
    return runtime
  }

  private buildSession(
    options: SpawnAgentOptions,
    worktree: { branch: string; path: string },
    ptyHandle: { id: string; pid: number }
  ): InternalSession {
    return {
      id: uuidv4(),
      projectId: options.projectId,
      runtimeId: options.runtimeId,
      branchName: worktree.branch,
      worktreePath: worktree.path,
      status: 'running',
      pid: ptyHandle.pid,
      ptyId: ptyHandle.id,
      outputBuffer: '',
      taskDescription: options.prompt || undefined,
      ollamaModel: options.ollamaModel,
      additionalDirs: [],
      noWorktree: options.noWorktree,
      nonInteractive: options.nonInteractive,
    }
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  sendInput(sessionId: string, input: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    if (session.nonInteractive) {
      // Print mode: spawn a new process that continues the previous conversation
      this.devServer.spawnPrintModeFollowUp(session, input.trim())
      return
    }

    if (!session.ptyId) return
    try {
      this.ptyPool.write(session.ptyId, input)
    } catch {
      // PTY may have already exited
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    try {
      this.ptyPool.resize(session.ptyId, cols, rows)
    } catch {
      // PTY may have already exited
    }
  }

  async killSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    // Remove from Map first so concurrent IPC handlers (e.g. diff:get)
    // won't try to use a worktree path that's being deleted.
    this.sessions.delete(sessionId)

    // Clean up additional dir watchers
    if (this.fileWatcher) {
      for (const dir of session.additionalDirs) {
        this.fileWatcher.unwatchAdditionalDir(dir, sessionId)
      }
    }

    this.chatAdapter?.clearSession(sessionId)

    if (session.ptyId) {
      this.ptyPool.kill(session.ptyId)
    }
    if (session.devServerPtyId) {
      try { this.ptyPool.kill(session.devServerPtyId) } catch { /* already exited */ }
    }

    if (session.projectId && !session.noWorktree) {
      try {
        await this.worktreeManager.removeWorktree(
          this.projectRegistry.getProject(session.projectId)?.path ?? '',
          session.worktreePath
        )
      } catch {
        // Worktree cleanup is best-effort
      }
    }
  }

  async resumeSession(sessionId: string, runtimeId: string): Promise<AgentSession> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)
    if (session.ptyId) return this.toPublicSession(session)

    if (!session.ollamaModel) {
      const meta = await readWorktreeMeta(session.worktreePath)
      if (meta?.ollamaModel) {
        session.ollamaModel = meta.ollamaModel
      }
    }

    const runtime = this.resolveRuntime(runtimeId)

    const runtimeArgs = [...(runtime.args ?? [])]
    if (session.ollamaModel) {
      runtimeArgs.push('--model', session.ollamaModel)
    }

    const ptyHandle = this.ptyPool.spawn(runtime.binary, runtimeArgs, {
      cwd: session.worktreePath,
      env: runtime.env,
    })

    session.ptyId = ptyHandle.id
    session.pid = ptyHandle.pid
    session.runtimeId = runtimeId
    session.status = 'running'
    session.outputBuffer = ''
    session.detectedUrl = undefined

    this.streamWirer.wireOutputStreaming(ptyHandle.id, session)
    this.streamWirer.wireExitHandling(ptyHandle.id, session)

    return this.toPublicSession(session)
  }

  getOutputBuffer(sessionId: string): string {
    const session = this.sessions.get(sessionId)
    return session ? session.outputBuffer : ''
  }

  getSession(sessionId: string): AgentSession | undefined {
    const session = this.sessions.get(sessionId)
    return session ? this.toPublicSession(session) : undefined
  }

  getDetectedUrl(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.detectedUrl ?? null
  }

  getSessionStatus(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.status ?? null
  }

  listSessions(): AgentSession[] {
    return Array.from(this.sessions.values()).map((s) => this.toPublicSession(s))
  }

  async discoverSessionsForProject(projectId: string): Promise<AgentSession[]> {
    await this.discovery.discoverSessionsForProject(projectId)
    return Array.from(this.sessions.values())
      .filter((s) => s.projectId === projectId)
      .map((s) => this.toPublicSession(s))
  }

  async discoverAllSessions(simpleProjectsBase?: string): Promise<AgentSession[]> {
    await this.discovery.discoverAllSessions(simpleProjectsBase)
    return Array.from(this.sessions.values()).map((s) => this.toPublicSession(s))
  }

  async killNonInteractiveSessions(projectId: string): Promise<{ killedIds: string[]; branchName?: string }> {
    const toKill = Array.from(this.sessions.values())
      .filter(s => s.projectId === projectId && s.nonInteractive)
    const killedIds: string[] = []
    let branchName: string | undefined

    for (const session of toKill) {
      branchName = session.branchName

      // Stop running processes so file system is stable before committing
      if (session.ptyId) {
        try { this.ptyPool.kill(session.ptyId) } catch { /* already exited */ }
        session.ptyId = ''
      }
      if (session.devServerPtyId) {
        try { this.ptyPool.kill(session.devServerPtyId) } catch { /* already exited */ }
        session.devServerPtyId = undefined
      }

      // Commit any uncommitted work so it survives the mode switch
      try {
        const status = await gitExec(['status', '--porcelain'], session.worktreePath)
        if (status.trim().length > 0) {
          await gitExec(['add', '-A'], session.worktreePath)
          await gitExec(['commit', '-m', 'Auto-commit: work from simple mode'], session.worktreePath)
          debugLog(`[session] auto-committed changes on branch ${branchName}`)
        }
      } catch (err) {
        debugLog(`[session] auto-commit failed: ${err}`)
      }

      await this.killSession(session.id)
      killedIds.push(session.id)
    }

    // Switch project directory back to base branch so new worktrees can be created
    if (branchName) {
      const project = this.projectRegistry.getProject(projectId)
      if (project) {
        try {
          await gitExec(['checkout', project.baseBranch], project.path)
          debugLog(`[session] switched project back to ${project.baseBranch}`)
        } catch (err) {
          debugLog(`[session] checkout base branch failed: ${err}`)
        }
      }
    }

    return { killedIds, branchName }
  }

  async killInteractiveSession(sessionId: string): Promise<{ projectPath: string; branchName: string; taskDescription?: string }> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    const branchName = session.branchName
    const taskDescription = session.taskDescription
    const worktreePath = session.worktreePath
    const projectId = session.projectId

    // Stop running processes so file system is stable before committing
    if (session.ptyId) {
      try { this.ptyPool.kill(session.ptyId) } catch { /* already exited */ }
      session.ptyId = ''
    }
    if (session.devServerPtyId) {
      try { this.ptyPool.kill(session.devServerPtyId) } catch { /* already exited */ }
      session.devServerPtyId = undefined
    }

    // Commit any uncommitted work so it survives the mode switch
    try {
      const status = await gitExec(['status', '--porcelain'], worktreePath)
      if (status.trim().length > 0) {
        await gitExec(['add', '-A'], worktreePath)
        await gitExec(['commit', '-m', 'Auto-commit: work from developer mode'], worktreePath)
        debugLog(`[session] auto-committed changes on branch ${branchName}`)
      }
    } catch (err) {
      debugLog(`[session] auto-commit failed: ${err}`)
    }

    // Remove the worktree but keep the branch alive — the dev server session
    // that follows will check out this branch in the project directory.
    if (!session.noWorktree) {
      try {
        await gitExec(['worktree', 'remove', worktreePath, '--force'], this.projectRegistry.getProject(projectId)?.path ?? '')
        await removeWorktreeMeta(worktreePath)
      } catch {
        // Best-effort cleanup
      }
      session.noWorktree = true
    }

    await this.killSession(sessionId)

    const project = this.projectRegistry.getProject(projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)

    return { projectPath: project.path, branchName, taskDescription }
  }

  async startDevServerSession(projectId: string, branchName: string, taskDescription?: string): Promise<{ sessionId: string }> {
    return this.devServer.startDevServerSession(projectId, branchName, taskDescription)
  }

  killAllSessions(): void {
    for (const session of this.sessions.values()) {
      try { this.ptyPool.kill(session.ptyId) } catch { /* best effort */ }
    }
    this.sessions.clear()
  }

  createShellSession(cwd: string): { sessionId: string } {
    const shell = process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL || '/bin/zsh')
    const ptyHandle = this.ptyPool.spawn(shell, [], { cwd })
    const id = uuidv4()

    const session: InternalSession = {
      id,
      projectId: '',
      runtimeId: '__shell__',
      branchName: '',
      worktreePath: cwd,
      status: 'running',
      pid: ptyHandle.pid,
      ptyId: ptyHandle.id,
      outputBuffer: '',
      additionalDirs: [],
    }

    this.sessions.set(id, session)
    this.streamWirer.wireOutputStreaming(ptyHandle.id, session)
    this.streamWirer.wireExitHandling(ptyHandle.id, session)

    return { sessionId: id }
  }

  private persistAdditionalDirs(session: InternalSession): void {
    writeWorktreeMeta(session.worktreePath, {
      runtimeId: session.runtimeId,
      taskDescription: session.taskDescription,
      additionalDirs: session.additionalDirs,
      ollamaModel: session.ollamaModel,
    }).catch(() => {})
  }

  private toPublicSession(session: InternalSession): AgentSession {
    return {
      id: session.id,
      projectId: session.projectId,
      runtimeId: session.runtimeId,
      branchName: session.branchName,
      worktreePath: session.worktreePath,
      status: session.status,
      pid: session.pid,
      taskDescription: session.taskDescription,
      additionalDirs: session.additionalDirs,
      noWorktree: session.noWorktree,
    }
  }
}
