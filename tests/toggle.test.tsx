import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'complex-mode',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

const SEND = 'mcp__complex-mode__send_message'
const READ = 'mcp__complex-mode__read_messages'

async function drain(stream: AsyncIterable<unknown> & { result: Promise<unknown> }) {
  for await (const _ of stream);
  return stream.result
}

const STEP = { turnId: 't1', index: 0, model: 'claude-haiku-5-5', effort: 'medium', messageCount: 1 } as const
const TYPED = { text: 'refactor the parser', wait: false, origin: { kind: 'sdk' } } as const

type Recorder = {
  sent: { model: string; effort?: unknown; agentId?: string }[]
  contexts: (readonly string[] | undefined)[]
  tools: string[]
  store: Map<string, unknown>
}

// Stand in for the engine beneath the mod.
type TestOn = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]

function engine(on: TestOn): Recorder {
  const r: Recorder = { sent: [], contexts: [], tools: [], store: new Map() }
  on('turn.step', async function* (_, e) {
    r.sent.push({ model: e.model, effort: e.effort, agentId: e.agentId })
    const model = e.model.includes('opus') ? 'claude-opus-5-5' : e.model
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: null,
      usage: { model, input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 9000 },
    }
  })
  on('prompt.submit', (_, e) => {
    r.contexts.push(e.context)
    return { drop: 'captured by the test' }
  })
  on('tool.register', (_, e) => {
    r.tools.push(e.name)
    return { value: { tool: `mcp__complex-mode__${e.name}` } }
  })
  on('command.register', () => ({ value: { command: 'complex' } }))
  on('store.get', (_, e) => ({ value: r.store.get(e.key) }))
  on('store.set', (_, e) => {
    r.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('agent.list', () => ({
    value: [{ id: 'a1', description: 'Map the parser', type: 'general-purpose', status: 'running' }],
  }))
  on('tool.call', () => ({ result: 'ok' }))

  return r
}

test('off changes nothing and adds no tools', async ($, on) => {
  const r = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true }).catch(() => {})

  await drain($.turn.step(STEP))
  await $.prompt.submit(TYPED).catch(() => {})
  expect(r.sent).toEqual([{ model: 'claude-haiku-5-5', effort: 'medium', agentId: undefined }])
  expect(r.contexts).toEqual([undefined])
  expect(r.tools).toEqual([])

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ text: /○ Off/ })).toBeDefined()
  expect(await ui.find({ key: 'complex-once' })).toBeDefined()
  await ui.unmount()
})

test('on forces the models, tallies usage, and notes only prompts the person sent', async ($, on) => {
  const r = engine(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'complex-toggle' })
  expect(await ui.find({ text: /● On/ })).toBeDefined()
  expect(r.tools).toEqual(['send_message', 'read_messages'])

  await drain($.turn.step(STEP))
  await drain($.turn.step({ ...STEP, agentId: 'a1' }))
  expect(r.sent).toEqual([
    { model: 'claude-opus-5-5', effort: 'xhigh', agentId: undefined },
    { model: 'claude-sonnet-5-5', effort: 'medium', agentId: 'a1' },
  ])
  expect((await ui.find({ text: /Used this session/ }))?.text).toContain('Opus 2k · Sonnet 2k')

  await $.prompt.submit(TYPED).catch(() => {})
  await $.prompt.submit({ ...TYPED, origin: { kind: 'task-notification' } }).catch(() => {})
  expect(r.contexts[0]?.[0]).toContain('Workflow tool')
  expect(r.contexts[1]).toBeUndefined()

  await ui.press({ key: 'complex-toggle' })
  await drain($.turn.step(STEP))
  expect(r.sent.at(-1)).toEqual({ model: 'claude-haiku-5-5', effort: 'medium', agentId: undefined })
  await ui.unmount()
})

test('once runs for one prompt and its work, then turns off at the next prompt', async ($, on) => {
  const r = engine(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'complex-once' })
  expect(await ui.find({ text: /your next prompt/ })).toBeDefined()

  await $.prompt.submit(TYPED).catch(() => {})
  expect(r.contexts[0]?.[0]).toContain('Complex-task mode is ON')
  await $.prompt.submit({ ...TYPED, origin: { kind: 'task-notification' } }).catch(() => {})
  await drain($.turn.step(STEP)) // the background work goes on, still forced
  expect(r.sent.at(-1)?.model).toBe('claude-opus-5-5')

  await $.prompt.submit(TYPED).catch(() => {})
  expect(r.contexts[2]).toBeUndefined()
  expect(await ui.find({ text: /○ Off/ })).toBeDefined()
  await ui.unmount()
})

test('agents message each other through the mailbox, delivered with tool results', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'complex-toggle' })

  // The subagent tells the orchestrator; it arrives with the orchestrator's next tool result.
  const sent = await $.tool.call({ tool: SEND, to: 'orchestrator', text: 'parser uses a hand-rolled lexer', agentId: 'a1' })
  expect(sent.deny).toBeUndefined()
  const bash = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(bash.deny === undefined ? bash.context?.join('\n') : '').toContain('[from Map the parser] parser uses a hand-rolled lexer')

  // The orchestrator answers everyone; the subagent reads it.
  await $.tool.call({ tool: SEND, to: 'all', text: 'keep the lexer, change the AST' })
  const inbox = await $.tool.call({ tool: READ, agentId: 'a1' })
  expect(inbox.deny === undefined ? String(inbox.result) : '').toContain('keep the lexer, change the AST')
  expect(inbox.deny === undefined ? String(inbox.result) : '').toContain('a1: Map the parser')

  // Delivered once only.
  const again = await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' })
  expect(again.deny === undefined ? again.context : ['x']).toBeUndefined()

  // Off closes the mailbox.
  await ui.press({ key: 'complex-toggle' })
  expect((await $.tool.call({ tool: SEND, to: 'all', text: 'hi' })).deny).toContain('off')
  await ui.unmount()
})

test('the band keeps what another mod draws beneath it', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>from prompt-improver</Text>
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'complex-toggle' })).toBeDefined()
  expect(await ui.find({ text: /from prompt-improver/ })).toBeDefined()
  await ui.unmount()
})
