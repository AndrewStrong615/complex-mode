/**
 * `once` is armed by a click and becomes `once-active` at the next prompt the person sends;
 * the prompt after that turns it off, so the whole task (background workflow included) runs on.
 */
export type Mode = 'off' | 'on' | 'once' | 'once-active'

/** One mailbox message between the orchestrator and its subagents. */
export type Message = {
  n: number
  /** `orchestrator`, or the sender's agent id. */
  from: string
  /** A readable name for the sender (the subagent's description). */
  fromLabel: string
  /** `orchestrator`, `all` (every subagent), or one agent id. */
  to: string
  text: string
  /** Who has had it delivered: `orchestrator` or agent ids. */
  readBy: string[]
}

/** Tokens this session while the mode was on, by model family; cache reads not counted. */
export type Usage = { opus: number; sonnet: number }

declare module 'claude-code' {
  interface PluginState {
    'complex-mode': {
      mode: Mode
      lastMain: string | null
      lastSub: string | null
      usage: Usage
      mailbox: Message[]
    }
  }
}
