---
name: github
description: GitHub operations via gh CLI
emoji: "🐙"
requires:
  bins: ["gh"]
---
# GitHub

Use the `gh` CLI to interact with GitHub repositories. Available operations:
- `gh repo list` — list repositories
- `gh issue list` — list issues
- `gh pr list` — list pull requests
- `gh pr create` — create pull requests
- `gh pr review` — review pull requests
- `gh release list` — list releases

Always verify the current repo context before running gh commands.
