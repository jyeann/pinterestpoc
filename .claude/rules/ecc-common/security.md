# Security

- Secrets come from environment variables or a secret manager, never from source. Rotate anything that may have been exposed.
- If you find a security issue mid-task, fix CRITICAL ones before continuing and use the `security-reviewer` agent for auth, user input, queries, file access and payments.
- Hooks in `.claude/harness/` and the deny rules in `.claude/settings.json` enforce the hard limits. Do not try to route around them.
