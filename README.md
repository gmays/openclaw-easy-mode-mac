# OpenClaw Easy Mode Mac

A simpler, safer, macOS-first distribution of OpenClaw.

`openclaw-easy-mode-mac` is an open source project built on top of [OpenClaw](https://github.com/openclaw/openclaw). The goal is to make OpenClaw dramatically easier for cautious users to install, understand, and trust on macOS, without asking them to run a full-power local agent with broad computer access on day one.

## Status

**Early project. Not production-ready.**

This repo currently starts from the upstream OpenClaw codebase and will evolve into a separate macOS app with its own product surface, defaults, and release flow.

## Why this exists

OpenClaw is powerful, but for many normal users the current setup and trust model are still too much all at once.

The default experience today is closer to:

- powerful
- flexible
- developer-friendly
- broad in capability

This project is aiming for something different:

- fast install
- narrow and understandable capability surface
- explicit access grants
- isolated browser profile
- clear migration path into full OpenClaw later

In plain English, the goal is to give users a version that feels much more like:

> install it, sign in, chat immediately, grant a couple folders, connect a few supported services, and know roughly what it can and cannot do.

## Project goals

### v1 goals

- Ship a **native macOS sibling app**
- Reuse as much of the existing OpenClaw core and macOS stack as possible
- Support a **very limited default capability set**
- Make **first chat fast**
- Use **explicit folder grants** instead of ambient file access
- Keep website automation inside a **dedicated agent browser profile**
- Provide a **one-click export path** into full OpenClaw

### Product principles

- **Restriction over cleverness**  
  Fewer capabilities by default is a feature, not a bug.

- **Explicit access over ambient access**  
  The app should only touch files, folders, and services the user clearly granted.

- **Separate agent context from personal context**  
  The agent should not silently inherit the user’s personal browser profile or broad machine access.

- **Shared core, separate product**  
  This project should stay close to upstream where it makes sense, while still becoming its own app.

## Non-goals for v1

These are intentionally out of scope for the first version:

- full desktop control
- shell execution
- elevated execution
- generic plugin install/update
- screen recording
- camera access
- arbitrary device/node control
- remote gateway features
- “control your whole computer” behavior

This is meant to be a restricted OpenClaw experience, not a disguised full-power agent.

## What “Easy Mode” means here

“Easy Mode” does **not** mean magic.

It means the app should eventually make these things easier:

- installing OpenClaw on macOS
- getting to first chat quickly
- signing in with supported auth flows
- granting only specific folders
- connecting a small number of supported messaging/services
- understanding what the agent can access

It also means making some hard tradeoffs:

- less power
- less flexibility
- fewer integrations at first
- more opinionated defaults

That tradeoff is the whole point.

## Planned user experience

The intended top-level experience is roughly:

1. Install the app
2. Sign in
3. Start chatting
4. Optionally grant a few folders
5. Optionally connect supported services
6. Use a dedicated agent browser for website automation
7. Export into full OpenClaw later if needed

The initial app surface is expected to stay very small:

- **Chat**
- **Access**
- **Connections**
- **Settings**
- **Export**

## Planned security model

The aim is to make this meaningfully safer than running a broad local agent, but not to make dishonest promises.

The security model is expected to rely on some combination of:

- restricted capability policy
- app-owned state
- explicit folder grants
- isolated browser profile
- reduced tool surface
- local-only control paths where possible
- separate app identity from full OpenClaw

Important: this project is trying to reduce risk, not pretend risk disappears.

Any agent that can browse websites, hold sessions, and touch user-approved files still has real security considerations. “Easy Mode” should mean narrower blast radius and clearer boundaries, not invincibility.

## Relationship to OpenClaw

This project is based on the excellent work in [OpenClaw](https://github.com/openclaw/openclaw).

OpenClaw remains the upstream engine and the foundation this project is built on. The intent here is not to erase that. The intent is to build a more opinionated macOS product layer on top of it.

### Upstream philosophy

Where possible, reusable improvements should be pushed back upstream.

That likely includes things like:

- policy seams
- allowed-roots interfaces
- export/import primitives
- capability gating improvements
- macOS integration seams that are broadly useful

Product-specific branding, app identity, onboarding, and release choices will live here.

## Syncing with upstream

This repo tracks the upstream OpenClaw repository through a Git remote named `upstream`.

Typical sync flow:

```bash
git fetch upstream
git merge upstream/main
