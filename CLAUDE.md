# CLAUDE.md

Guidance for AI agents working in this repository.

## What this is

An unofficial Android client for Papra (self-hosted document archiving), built with
Expo / React Native (TypeScript strict, expo-router, react-native-paper MD3 dark-only).
The full server API reference lives in docs/PAPRA-API.md.

## Hard rules

- **NEVER build the APK locally** (no `gradlew`, no `expo prebuild && gradle`). A local
  Gradle build once froze the production VM this repo is developed on. CI builds the APK.
  Verify with `npx tsc --noEmit` only.
- **README.md must stay current: whenever you add, remove or materially change a
  user-facing feature, update the Features section of README.md in the same commit.**
  The README is the product page users see on GitHub/Obtainium — it must always list
  every implemented feature.
- Conventional commits (`feat:`/`fix:`/`docs:`/`ci:`; `!` for breaking). CI computes the
  release version from commit subjects since the last tag and releases a signed APK on
  push to main — only after a green build.
- `android/` and `ios/` are generated (CNG) and gitignored; never edit or commit them.
- Deletes in the UI always get a confirmation dialog; document deletions mention the
  30-day trash retention.

## Layout

- `src/app/` — expo-router screens; `(drawer)/` group is the hamburger navigation.
- `src/lib/papra.ts` — typed REST client (see docs/PAPRA-API.md before adding endpoints).
- `src/lib/db.ts` — SQLite offline mirror; `src/lib/sync.ts` — sync job + file handling.
- `src/components/ui.tsx` — shared primitives on react-native-paper; MD3 theme in
  `src/constants/theme.ts` (dynamic color, papra-green fallback).
- `scripts/gen-icons.py` — regenerates all icon renders from assets/images/icon.svg.
