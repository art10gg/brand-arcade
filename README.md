# Brand Arcade – White-Label Gaming-Plattform

Werbe-Spieleplattform: Kart-Racer (Pseudo-3D) + Jump'n'Run, in die Firmenkunden
ihre Marken-Avatare als Spielfigur lizenzieren. Browser + Tablet (PWA).

**Wichtig:** Eigenständige Spiele im Kart-/Plattformer-Genre. Keine Nintendo-
Assets, -Namen oder -Designelemente — weder im Code noch im Marketing.

## Start

```bash
npm install
npm run dev            # http://localhost:5173/?brand=demo-brand
```

## Struktur

- `packages/core` — Brand-Manifest, Avatar-Rig, Theming (das Herzstück)
- `packages/game-platformer` / `packages/game-kart` — die Spiele
- `apps/web` — PWA-Shell mit Spielauswahl
- `brands/_template` — Onboarding-Vorlage für neue Kunden (siehe README dort)
- `brands/<kunde>` — 1 Ordner pro Firmenkunde, null Code-Änderung

## Avatar-Wechsel

Spiel-Code kennt nur `avatarKey()` + Rig-Animationen. Kunden liefern Spritesheets
laut `brands/_template/README.md`; fehlt ein Sheet, rendert die Engine einen
Platzhalter in Markenfarbe. Auswahl zur Laufzeit über `?brand=<id>`.
