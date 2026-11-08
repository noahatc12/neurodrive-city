/**
 * Undo/redo command history (capped). Every editor mutation goes through a
 * {@link Command}, so undo covers points, segments, splits, one-way toggles,
 * multi-selection moves and deletes, markings and world disposal alike.
 *
 * @module editor/history
 */

export interface Command {
  /** Short label shown in toasts, e.g. "Add point". */
  readonly label: string;
  /** Applies (or re-applies) the change. */
  do(): void;
  /** Reverts the change exactly. */
  undo(): void;
}

export class History {
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];
  private readonly listeners = new Set<() => void>();
  readonly cap: number;

  constructor(cap = 200) {
    this.cap = cap;
  }

  /**
   * Records a command. With `execute = true` (default) it is applied first; pass false
   * for changes already applied live (e.g. a finished drag).
   */
  push(cmd: Command, execute = true): void {
    if (execute) cmd.do();
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.cap) this.undoStack.shift();
    this.redoStack.length = 0;
    this.notify();
  }

  undo(): Command | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    cmd.undo();
    this.redoStack.push(cmd);
    this.notify();
    return cmd;
  }

  redo(): Command | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    cmd.do();
    this.undoStack.push(cmd);
    this.notify();
    return cmd;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoSize(): number {
    return this.undoStack.length;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.notify();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

/** Groups several commands into one undo step. */
export class CompositeCommand implements Command {
  readonly label: string;
  private readonly commands: Command[];

  constructor(label: string, commands: Command[]) {
    this.label = label;
    this.commands = commands;
  }

  do(): void {
    for (const c of this.commands) c.do();
  }

  undo(): void {
    for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i]?.undo();
  }
}
