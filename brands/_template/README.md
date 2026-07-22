# Brand-Template: So wird ein Firmenkunde integriert

Ein neuer Kunde = dieser Ordner kopiert nach `brands/<kunden-id>/` mit eigenen
Assets. **Es ist keine Code-Änderung nötig.** Aufruf: `https://…/?brand=<kunden-id>`

## Pflicht

- `brand.json` — Name, Markenfarben (hex), Verweise auf Assets

## Optional (bei Fehlen generiert die Engine einen Platzhalter-Avatar aus `colors.avatar`)

- `avatar/platformer.png` — Spritesheet 64×64 px/Frame, Animationen laut Rig:
  `idle`, `run`, `jump`, `fall`, `hit`, `win`
- `avatar/kart.png` — Spritesheet 96×96 px/Frame, Animationen laut Rig:
  `drive`, `drift-left`, `drift-right`, `boost`, `hit`
- `logo.png` — transparentes PNG, min. 512 px Breite
- `audio/jingle.mp3` — kurzer Marken-Jingle (< 5 s)

## Rig-Konvention

- Blickrichtung im Sheet: **rechts** (die Engine spiegelt für links)
- Pivot: Frame-Mitte, Figur bodenbündig
- Frame-Bereiche pro Animation in `brand.json` als `[startFrame, endFrame, frameRate]`

## Rechtlicher Hinweis

Nur Assets verwenden, an denen der Kunde nachweislich die Rechte hält
(schriftliche Bestätigung im Lizenzvertrag).
