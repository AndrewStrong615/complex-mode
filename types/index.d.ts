declare module 'claude-code' {
  interface PluginState {
    'complex-mode': {
      isOn: boolean
      /** The model and effort the last main-loop and subagent requests went out with, for the band's check line. */
      lastMain: string | null
      lastSub: string | null
    }
  }
}
