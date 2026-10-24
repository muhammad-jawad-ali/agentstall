# Contributing

- Branch from `main`, keep pull requests small, and get one teammate's review before merging.
- `npm run typecheck` and `npm test` must pass; CI runs both on every PR.
- Never commit secrets. Credentials live in `.env` locally and in Render environment variables in production.
- Sandbox only: this project never touches live PayPal credentials.
