import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const isOn = atom({ plugin: 'complex-mode', key: 'isOn' } as const, false)
const lastMain = atom({ plugin: 'complex-mode', key: 'lastMain' } as const, null as string | null)
const lastSub = atom({ plugin: 'complex-mode', key: 'lastSub' } as const, null as string | null)

const ORCHESTRATOR = 'claude-opus-5-5'
const ORCHESTRATOR_EFFORT = 'xhigh' as const
const SUBAGENT = 'claude-sonnet-5-5'

const NOTE = `Complex-task mode is ON: the user turned it on with their toggle above the prompt box, and this
counts as their explicit opt-in to multi-agent orchestration for this request.
- If the request involves real work (not a quick question or chat), orchestrate it with the Workflow tool.
- You are the orchestrator, on Opus 5.5 at xhigh effort. Run every subagent on Sonnet 5.5: pass
  model: 'sonnet' to each agent() call. (The toggle also enforces both models on every request.)
- Keep to the session's workflow size guideline unless the user asks for a different scale.`

export const register: Register = on => {
  // While on: every request is forced to the orchestrator or subagent model. While off: untouched.
  on('turn.step', async function* ($, e, next) {
    if (!(await read($, isOn))) return yield* next(e)

    const isSub = e.agentId !== undefined
    const step = isSub ? { ...e, model: SUBAGENT } : { ...e, model: ORCHESTRATOR, effort: ORCHESTRATOR_EFFORT }
    const result = yield* next(step)

    const seen = `${result.usage?.model ?? step.model}${step.effort === undefined ? '' : ` · ${step.effort}`}`
    if (isSub) await update($, lastSub, () => seen)
    else await update($, lastMain, () => seen)

    return result
  })

  // While on: each prompt the person sends carries the instruction to use a workflow.
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || e.isMeta || !(await read($, isOn))) return next(e)

    return next({ ...e, context: [...(e.context ?? []), NOTE] })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const enabled = await read($, isOn)
    const main = await read($, lastMain)
    const sub = await read($, lastSub)
    const below = await next(e) // keep whatever another mod (prompt-improver) draws here
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" gap={1}>
        <Box
          borderStyle="round"
          borderColor={enabled ? 'claude' : 'subtle'}
          paddingX={1}
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          gap={2}
        >
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text weight="semibold">
              🧠 Complex mode{' '}
              <Text color={enabled ? 'success' : 'subtle'} weight="medium">
                {enabled ? '● On' : '○ Off'}
              </Text>
            </Text>
            <Text size="footnote" color="subtle">
              {enabled
                ? 'Opus 5.5 (extra-high effort) orchestrates · subagents on Sonnet 5.5'
                : 'For big tasks: Opus 5.5 runs a workflow of Sonnet 5.5 subagents'}
            </Text>
            {enabled && (main !== null || sub !== null) && (
              <Text size="caption" color="subtle" mono>
                last request {main ?? '—'} · last subagent {sub ?? '—'}
              </Text>
            )}
          </Box>
          <Button
            key="complex-toggle"
            variant={enabled ? 'secondary' : 'primary'}
            label={enabled ? 'Turn off' : 'Turn on'}
            onPress={async () => {
              await update($, lastMain, () => null)
              await update($, lastSub, () => null)
              await update($, isOn, v => !v)
            }}
          />
        </Box>
        {below}
      </Box>
    )
  })
}
