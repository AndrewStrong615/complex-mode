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

async function drain(stream: AsyncIterable<unknown> & { result: Promise<unknown> }) {
  for await (const _ of stream);
  return stream.result
}

const STEP = { turnId: 't1', index: 0, model: 'claude-haiku-5-5', effort: 'medium', messageCount: 1 } as const

test('off changes nothing; on forces the models and adds the workflow note', async ($, on) => {
  const sent: { model: string; effort?: unknown; agentId?: string }[] = []
  const contexts: (readonly string[] | undefined)[] = []

  // Stand in for the engine beneath the mod: record what each request and prompt went out with.
  on('turn.step', async function* (_, e) {
    sent.push({ model: e.model, effort: e.effort, agentId: e.agentId })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })
  on('prompt.submit', (_, e) => {
    contexts.push(e.context)
    return { drop: 'captured by the test' }
  })
  const prompt = { text: 'refactor the parser', wait: false, origin: { kind: 'composer' } } as const

  // Off: untouched.
  await drain($.turn.step(STEP))
  await $.prompt.submit(prompt).catch(() => {})
  expect(sent).toEqual([{ model: 'claude-haiku-5-5', effort: 'medium', agentId: undefined }])
  expect(contexts).toEqual([undefined])

  // Turn it on from the band, on the desktop surface.
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ text: /○ Off/ }))).toBeDefined()
  await ui.press({ key: 'complex-toggle' })
  expect((await ui.find({ text: /● On/ }))).toBeDefined()

  await drain($.turn.step(STEP))
  await drain($.turn.step({ ...STEP, agentId: 'a1' }))
  await $.prompt.submit(prompt).catch(() => {})
  expect(sent.slice(1)).toEqual([
    { model: 'claude-opus-5-5', effort: 'xhigh', agentId: undefined },
    { model: 'claude-sonnet-5-5', effort: 'medium', agentId: 'a1' },
  ])
  expect(contexts[1]?.[0]).toContain('Workflow tool')

  // And off again: back to untouched.
  await ui.press({ key: 'complex-toggle' })
  await drain($.turn.step(STEP))
  expect(sent.at(-1)).toEqual({ model: 'claude-haiku-5-5', effort: 'medium', agentId: undefined })
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
