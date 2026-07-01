# agent-stuff

A bunch of skills that I use daily, either original ones or stuff that I changed a bit to better fit my workflow.

<p align="center">
  <img src="assets/agent-stuff-readme-cutout.png" alt="Agent Stuff mascot" width="280">
</p>

## Install

### [skills.sh](https://skills.sh)

```bash
# install all skills
npx skills add lucasbsartor/agent-stuff -g -y

# see what's available
npx skills add lucasbsartor/agent-stuff --list

# install one skill
npx skills add lucasbsartor/agent-stuff --skill handoff -g -y
```

`-g` installs to your user skill dirs (Cursor, Claude Code, etc.). Omit it for a project-local install.

### Codex

```bash
codex plugin marketplace add lucasbsartor/agent-stuff
codex plugin add agent-stuff@agent-stuff
```

## Skills


| Skill | Use | Adapted from |
|-------|-----|--------------|
| `wmd-review` | Deep correctness, security, devex, and feature-gate review for diffs, branches, files, or repos. | [Cursor Thermos](https://github.com/cursor/plugins) |
| `wmd-code-quality-review` | Strict maintainability and structure review — abstraction quality, file size, spaghetti growth. | [Cursor Thermos](https://github.com/cursor/plugins) |
| `handoff` | Copyable delegation prompt for another agent (returns a ` ```text ` block, not clipboard). | [openclaw/agent-skills](https://github.com/openclaw/agent-skills) |


- **wmd-review** — `Run wmd-review on this branch.`
- **wmd-code-quality-review** — `Review maintainability of src/auth/ with wmd-code-quality-review.`
- **handoff** — `handoff: fix the session expiry bug`

Both WMD skills together — `Run both WMD reviews on this diff and give me one deduped report.`

