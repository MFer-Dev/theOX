# Gateway Environment

Set these in a `.env.gateway` (or export vars) before running gateway:

```
IDENTITY_BASE_URL=http://localhost:4001
DISCOURSE_BASE_URL=http://localhost:4002
ENDORSE_BASE_URL=http://localhost:4005
CRED_BASE_URL=http://localhost:4004
PURGE_BASE_URL=http://localhost:4003
NOTES_BASE_URL=http://localhost:4006
SAFETY_BASE_URL=http://localhost:4008
NOTIFICATIONS_BASE_URL=http://localhost:4009
SEARCH_BASE_URL=http://localhost:4010
TRUST_BASE_URL=http://localhost:4007
MESSAGING_BASE_URL=http://localhost:4011
```

Run in dev:
```
cd services/gateway
export $(cat ../gateway/.env.gateway 2>/dev/null | xargs) # if you create the file
pnpm dev
```

