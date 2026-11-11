import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Message, Mode, Usage } from '../types'

const mode = atom({ plugin: 'complex-mode', key: 'mode' } as const, 'off' as Mode)
const lastMain = atom({ plugin: 'complex-mode', key: 'lastMain' } as const, null as string | null)
const lastSub = atom({ plugin: 'complex-mode', key: 'lastSub' } as const, null as string | null)
const usage = atom({ plugin: 'complex-mode', key: 'usage' } as const, { opus: 0, sonnet: 0 } as Usage)
const mailbox = atom({ plugin: 'complex-mode', key: 'mailbox' } as const, [] as Message[])

const ORCHESTRATOR = 'claude-opus-5-5'
const ORCHESTRATOR_EFFORT = 'xhigh' as const
const SUBAGENT = 'claude-sonnet-5-5'

const SEND = 'mcp__complex-mode__send_message'
const READ = 'mcp__complex-mode__read_messages'

// $.store key: new sessions start with the mode on.
const KEEP_ON = 'keepOn'

// Prompts the person sent (any surface, or prompt-improver's Send it); not task notices, schedules or peers.
const BY_PERSON = new Set(['composer', 'sdk', 'bridge', 'plugin', 'unclassified'])

const NOTE = `Complex-task mode is ON: the user turned it on with their toggle above the prompt box, and this
counts as their explicit opt-in to multi-agent orchestration for this request.
- If the request involves real work (not a quick question or chat), orchestrate it with the Workflow tool.
- You are the orchestrator, on Opus 5.5 at xhigh effort. Run every subagent on Sonnet 5.5: pass
  model: 'sonnet' to each agent() call. (The toggle also enforces both models on every request.)
- You and the subagents share a mailbox: ${SEND} (to: "orchestrator", "all", or an agent id) and
  ${READ}. New messages also arrive on their own with any tool result. Tell each subagent, in its
  prompt, to send you findings or questions that affect the others, and to act on messages it receives.
  While you wait on a running Workflow you read nothing until it returns; when agents must coordinate
  live, run them as background subagents (Agent tool) instead.
- Keep to the session's workflow size guideline unless the user asks for a different scale.`

const SUB_NOTE = `You are a subagent working with an orchestrator and other subagents. Share findings or questions that
affect the others with ${SEND} (to: "orchestrator", "all", or an agent id); read new messages with
${READ}. Messages also arrive on their own with your tool results: act on them.`

const isActive = (m: Mode) => m === 'on' || m === 'once-active'
const short = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)

async function addTools($: EngineInterface): Promise<void> {
  await $.tool.register({
    name: 'send_message',
    description:
      'Complex mode mailbox: send a message to the orchestrator, to all subagents, or to one agent by id. ' +
      'It reaches them with their next tool result.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: '"orchestrator", "all" (every subagent), or an agent id' },
        text: { type: 'string', description: 'The message' },
      },
      required: ['to', 'text'],
    },
  })
  await $.tool.register({
    name: 'read_messages',
    description: 'Complex mode mailbox: read your unread messages and see which agents are running, with their ids.',
    inputSchema: { type: 'object', properties: {} },
  })
}

async function setMode($: EngineInterface, next: Mode): Promise<void> {
  if (next !== 'off') await addTools($)
  if (next === 'off' || next === 'once') await $.store.set(KEEP_ON, false)
  await update($, lastMain, () => null)
  await update($, lastSub, () => null)
  await update($, mode, () => next)
}

// Unread messages for one reader, marked delivered.
async function takeUnread($: EngineInterface, reader: string): Promise<Message[]> {
  const isFor = (m: Message) =>
    !m.readBy.includes(reader) && m.from !== reader && (m.to === reader || (m.to === 'all' && reader !== 'orchestrator'))
  const unread = (await read($, mailbox)).filter(isFor)
  if (unread.length > 0) {
    await update($, mailbox, box => box.map(m => (isFor(m) ? { ...m, readBy: [...m.readBy, reader] } : m)))
  }

  return unread
}

const show = (msgs: Message[]) =>
  msgs.map(m => `[from ${m.fromLabel}${m.to === 'all' ? ' to all' : ''}] ${m.text}`).join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'complex',
      description: 'Complex mode: /complex on, off or once; no argument toggles',
    })
    const current = await read($, mode)
    if ((await $.store.get(KEEP_ON)) === true && current === 'off') await update($, mode, () => 'on')
    if ((await read($, mode)) !== 'off') await addTools($)

    return next(e)
  })

  on('command.run', { command: 'complex' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const current = await read($, mode)
    const wanted: Mode | null =
      arg === 'on' ? 'on' : arg === 'off' ? 'off' : arg === 'once' ? 'once' : arg === '' ? (current === 'off' ? 'on' : 'off') : null
    if (wanted === null) return { text: 'Usage: /complex [on|off|once]' }
    await setMode($, wanted)

    return {
      text:
        wanted === 'off'
          ? 'Complex mode is off.'
          : wanted === 'once'
            ? 'Complex mode is on for your next prompt and its work.'
            : 'Complex mode is on.',
    }
  })

  // While active: every request is forced to the orchestrator or subagent model, and its tokens are tallied.
  on('turn.step', async function* ($, e, next) {
    if (!isActive(await read($, mode))) return yield* next(e)

    const isSub = e.agentId !== undefined
    const step = isSub ? { ...e, model: SUBAGENT } : { ...e, model: ORCHESTRATOR, effort: ORCHESTRATOR_EFFORT }
    const result = yield* next(step)

    const u = result.usage
    const seen = `${u?.model ?? step.model}${step.effort === undefined ? '' : ` · ${step.effort}`}`
    if (isSub) await update($, lastSub, () => seen)
    else await update($, lastMain, () => seen)
    if (u !== null) {
      // ponytail: cache reads left out (they cost a tenth); add them if a full total is wanted.
      const tokens = u.input_tokens + u.output_tokens + (u.cache_creation_input_tokens ?? 0)
      const isOpus = u.model.includes('opus')
      await update($, usage, x => (isOpus ? { ...x, opus: x.opus + tokens } : { ...x, sonnet: x.sonnet + tokens }))
    }

    return result
  })

  // Each prompt the person sends carries the workflow note; `once` runs for one prompt and its work.
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || e.isMeta || !BY_PERSON.has(e.origin.kind)) return next(e)

    let current = await read($, mode)
    if (current === 'once') current = 'once-active'
    else if (current === 'once-active') current = 'off'
    if (current !== (await read($, mode))) await update($, mode, () => current)
    if (!isActive(current)) return next(e)

    return next({ ...e, context: [...(e.context ?? []), NOTE] })
  })

  // Subagents started while active are told about the mailbox.
  on('agent.spawn', async ($, e, next) => {
    if (!isActive(await read($, mode))) return next(e)

    return next({ ...e, prompt: `${e.prompt}\n\n${SUB_NOTE}` })
  })

  on('tool.call', { tool: SEND }, async ($, e) => {
    if (!isActive(await read($, mode))) return { deny: 'Complex mode is off; the mailbox is closed.' }
    const input = e as unknown as { to?: unknown; text?: unknown; agentId?: string }
    const to = typeof input.to === 'string' ? input.to.trim() : ''
    const text = typeof input.text === 'string' ? input.text.trim() : ''
    if (to.length === 0 || text.length === 0) return { deny: 'send_message needs a "to" and a "text".' }

    const from = input.agentId ?? 'orchestrator'
    const agents = await $.agent.list()
    const fromLabel = from === 'orchestrator' ? 'orchestrator' : (agents.find(a => a.id === from)?.description ?? from)
    if (to !== 'orchestrator' && to !== 'all' && !agents.some(a => a.id === to)) {
      return { deny: `No agent "${to}". Use "orchestrator", "all", or an id from read_messages.` }
    }
    await update($, mailbox, box => [...box, { n: box.length + 1, from, fromLabel, to, text, readBy: [] }])

    return { result: `Sent to ${to}. It arrives with their next tool result.` }
  })

  on('tool.call', { tool: READ }, async ($, e) => {
    if (!isActive(await read($, mode))) return { deny: 'Complex mode is off; the mailbox is closed.' }
    const reader = (e as unknown as { agentId?: string }).agentId ?? 'orchestrator'
    const unread = await takeUnread($, reader)
    const running = (await $.agent.list()).filter(a => a.status === 'running' || a.status === 'waiting' || a.status === 'idle')
    const roster = running.map(a => `- ${a.id}: ${a.description} (${a.status})`).join('\n') || '- none'

    return {
      result: `${unread.length > 0 ? show(unread) : 'No new messages.'}\n\nAgents you can message (plus "orchestrator" and "all"):\n${roster}`,
    }
  })

  // While active: new messages ride along with any other tool's result.
  on('tool.call', async ($, e, next) => {
    if (e.tool === SEND || e.tool === READ || !isActive(await read($, mode))) return next(e)
    const result = await next(e)
    if (result.deny !== undefined) return result

    const unread = await takeUnread($, e.agentId ?? 'orchestrator')
    if (unread.length === 0) return result

    return { ...result, context: [...(result.context ?? []), `New mailbox messages:\n${show(unread)}`] }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const current = await read($, mode)
    const below = await next(e) // keep whatever another mod (prompt-improver) draws here
    const { Box, Button, Text } = $.ui.resolve(e)

    // Shared design with prompt-improver: idle is one quiet line with no card; otherwise one flat card (title
    // row with status right, subtle body, all actions right-aligned). A lasting state (this card) gets a
    // neutral border; an orange border is kept for a card that waits on the person (prompt-improver's).
    if (current === 'off') {
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={2} paddingX={2}>
            <Text size="footnote" color="subtle">
              🧠 Complex mode · Off
            </Text>
            <Box flexDirection="row" alignItems="center" gap={1}>
              <Button key="complex-once" label="Once" onPress={() => setMode($, 'once')} />
              <Button key="complex-toggle" variant="primary" label="Turn on" onPress={() => setMode($, 'on')} />
            </Box>
          </Box>
          {below}
        </Box>
      )
    }

    const main = await read($, lastMain)
    const sub = await read($, lastSub)
    const used = await read($, usage)
    const box = await read($, mailbox)
    const keepOn = (await $.store.get(KEEP_ON)) === true
    const status = current === 'once' ? 'Once · next prompt' : current === 'once-active' ? 'Once · this task' : 'On'

    // One meta line, only the parts that have something to say.
    const model = (s: string | null) => (s === null ? '—' : s.replace(/^claude-/, ''))
    const meta = [
      used.opus > 0 || used.sonnet > 0
        ? `${[used.opus > 0 ? `Opus ${short(used.opus)}` : null, used.sonnet > 0 ? `Sonnet ${short(used.sonnet)}` : null]
            .filter(part => part !== null)
            .join(' · ')} tokens`
        : null,
      box.length > 0 ? `${box.length} message${box.length === 1 ? '' : 's'}` : null,
      main !== null || sub !== null ? `last ${model(main)} / ${model(sub)}` : null,
    ]
      .filter(part => part !== null)
      .join(' · ')

    const about =
      current === 'once'
        ? 'Opus 5.5 + Sonnet 5.5 subagents for your next prompt and its work'
        : current === 'once-active'
          ? 'Opus 5.5 + Sonnet 5.5 subagents until you send your next prompt'
          : 'Opus 5.5 orchestrates · Sonnet 5.5 subagents · shared mailbox'

    return (
      <Box flexDirection="column" gap={1}>
        <Box borderStyle="round" borderColor="subtle" paddingX={2} flexDirection="column" gap={1}>
          <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={2}>
            <Text weight="semibold">🧠 Complex mode</Text>
            <Text size="footnote" weight="medium" color="claude">
              {status}
            </Text>
          </Box>
          <Text size="footnote" color="subtle">
            {about}
          </Text>
          {meta.length > 0 && (
            <Text size="caption" color="subtle" wrap="truncate-end">
              {meta}
            </Text>
          )}
          <Box flexDirection="row" alignItems="center" justifyContent="flex-end" gap={1}>
            {current === 'on' && (
              <Button
                key="complex-keep"
                plain
                dimColor={!keepOn}
                label={keepOn ? '✓ On in new sessions' : 'Keep on in new sessions'}
                onPress={async () => {
                  await $.store.set(KEEP_ON, !keepOn)
                  $.ui.invalidate('ui.render')
                }}
              />
            )}
            <Button key="complex-toggle" label="Turn off" onPress={() => setMode($, 'off')} />
          </Box>
        </Box>
        {below}
      </Box>
    )
  })
}
