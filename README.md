# complex-mode

A Claude Code mod that adds a **🧠 Complex mode** toggle above the prompt box, for big tasks.

## What it does

- **On:** every request in the main conversation goes to Opus 5.5 at extra-high (`xhigh`) effort, and every
  subagent runs on Sonnet 5.5. Each prompt you send also carries a short note asking Claude to orchestrate
  real work with the Workflow tool (quick questions still just get answered).
- **Off:** nothing changes. It starts off in every new session.
- While it's on, a small line under the toggle shows the model each request was actually answered by, so you
  can see it working.

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
