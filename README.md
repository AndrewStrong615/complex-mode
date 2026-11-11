# complex-mode

A Claude Code mod that adds a **🧠 Complex mode** toggle above the prompt box, for big tasks.

## What it does

- **On:** every request in the main conversation goes to Opus 5.5 at extra-high (`xhigh`) effort, and every
  subagent runs on Sonnet 5.5. Each prompt you send also carries a short note asking Claude to orchestrate
  real work with the Workflow tool (quick questions still just get answered). Automatic prompts (background
  task notices, scheduled runs, other sessions) don't get the note.
- **Once:** on for your next prompt and all the work it starts, background workflows included; it switches
  itself off when you send the prompt after that.
- **Off:** nothing changes. It starts off in every new session, unless you pick **Keep on in new sessions**.
- **Agents can talk:** the orchestrator and its subagents share a mailbox (`send_message` to `orchestrator`,
  `all`, or an agent id, and `read_messages`). New messages also arrive by themselves with an agent's next
  tool result. While the orchestrator waits on a running Workflow it reads nothing until the workflow
  returns; for live back-and-forth it runs background subagents. The tools are added the first time you
  turn the mode on in a session, and refuse calls while it's off.
- **See what it's doing:** the card shows tokens used this session by model (cache reads not counted), how
  many messages agents have exchanged, and the model each request was actually answered by.
- `/complex`, `/complex on`, `/complex off`, `/complex once` toggle it from the keyboard.

Works in the terminal and in the Claude desktop app. It shares the band above the prompt box with other mods
(such as prompt-improver) without hiding them.

Switching models mid-conversation drops prompt caching for that switch, so the first request after turning
it on costs more.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install complex-mode --marketplace AndrewStrong615/complex-mode
```

Answer `y` to add the marketplace, then pick a scope (user scope is first).

From a shell:

```bash
claude plugin install complex-mode --marketplace AndrewStrong615/complex-mode
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**,
**Add marketplace** with `AndrewStrong615/complex-mode`, then **Add plugin**.
