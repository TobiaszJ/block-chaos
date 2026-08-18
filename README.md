# 🧊 BLÖCK CHAOS

Ein ernstzunehmendes Physik-Spiel aus Würfeln. **Echte Physik** (Rapier), **echtes WebGPU**,
null Konsequenzen. Die Welt ist ein zuckersüßes **Candy-Diorama** auf einem Podest –
und du darfst sie komplett zerlegen.

![tech](https://img.shields.io/badge/WebGPU-three.js%20r185-7fd4ff) ![physik](https://img.shields.io/badge/Physik-Rapier%20WASM-ff5d8f) ![version](https://img.shields.io/badge/Version-0.4.0%20Alpha-ff5d8f)

> 🐢 **Alpha v0.4** – Alle Features sind real. **Neu: Crash-Schutz per
> adaptivem Element-Budget** – Das System misst seine eigene FPS und senkt
> bei Atemnot (<25 fps) automatisch Objekt- und Wasser-Budget: Die ältesten
> Blöcke *puffen* weg, altes Wasser verdunstet (🐢 im HUD). Hat es wieder
> Luft (≥55 fps für ~2s), wächst das Budget bis zur harten Grenze zurück.
> Ein Notbrems-Gürtel halbiert das Budget sofort, wenn ein einzelner
> Physik-Frame >250 ms dauert. Damit crasht kein System mehr, das zu viele
> Elemente bekommt – schwache Geräte bekommen einfach weniger Chaos. Auf dem
> Fundament des v0.3 Performance-Pakets (Dirty-Tracking, Positions-Cache,
> Spiral-of-death-Gürtel). `perf.mjs` misst beides nach.

> ⚠️ **Kein einziger Fake-Feature.** Jede angegebene Fähigkeit ist real implementiert und per
> automatisiertem Test (Playwright, siehe `test/`) verifiziert.

## 🌐 Direkt spielen

**[tobiaszj.github.io/block-chaos](https://tobiaszj.github.io/block-chaos)** – kein Setup, einfach klicken.
(Braucht WebGPU: Chrome/Edge 113+, Firefox 141+. Funktioniert auch mobil.)

---

## ▶️ Starten

```bash
npm install
npm run dev
# → http://localhost:5173
```

**WebGPU wird benötigt.** Nutze einen aktuellen Chrome/Edge.
Auf Linux ggf. mit `--enable-unsafe-webgpu`.

### Produktions-Build

```bash
npm run build     # → dist/
npm run preview   # → dist/ lokal testen
```

---

## 🎮 Steuerung

| Eingabe | Aktion |
|---|---|
| **Linksklick** | Block zerschlagen · Kanone feuern · TNT zünden |
| **Rechtsklick** | Gewählten Block platzieren |
| **1–0** | Block wählen (s. Hotbar) |
| **WASD + Leertaste/Shift** | Durch die Welt fliegen |
| **E** | Block in Kamera-Richtung wegknallen |
| **L** (halten) | ☢ **Laser** – schmilzt alles im Weg |
| **X** | 🌍 Gravitation umdrehen (wörtlich) |
| **B** (halten) | 🐌 Zeitlupe |
| **C** | Alle Kanonen gleichzeitig feuern |
| **T** | Windböe fliegt dir entgegen |
| **G** | 8 Sekunden Regen |
| **N** | Tag ↔ Nacht |
| **P** | 📸 Screenshot (PNG-Download) |
| **M** | Ton an/aus |
| **Strg+Z** | ↩️ Rückgängig (bis 40 Schritte) |
| **Strg+S / Strg+L** | 💾 Speichern / 📂 Laden (localStorage) |
| **R** | Neustart |

### 📱 Mobil (Touch)

- **Linke Seite ziehen** → Joystick (bewegt die Kamera)
- **Rechte Seite wischen** → Kamera drehen
- **Tappen** → am Fadenkreuz bauen oder brechen (Mode-Umschalter unten)
- **▲/▼** → hoch/runter fliegen
- **Werkzeug-Grid (rechts)** → 🙃 Grav-Flip · 🌙 Tag/Nacht · 💨 Wind · 🌧️ Regen · 🧨 Kanonen · ☢ Laser (halten)

**Hotbar (1–0):** Holz · Stein · Eis · Gummi · TNT · Wasserquelle · Kanone · Schwarzes Loch · Ballon · Kette

---

## 📦 Features

### 🧲 Echte Physik (Rapier 3D, WASM)
- Jeder Block ist ein echtes Rigid Body mit Masse, Reibung & Restitution.
- **Gravitation-Flip** (X) – alles fällt nach oben.
- **Kette** – zwei Blöcke werden per *Revolute-Joint* verbunden und schwingen.
- **Ballon** – echtes Auftriebs-Verhalten (schwimmt hoch, platzt in der Höhe).
- **Schwarze Löcher** – saugen langsam benachbarte Blöcke an und **wachsen**
  mit jeder Beute (greifen weiter, saugen stärker, Mund wird größer). Explodieren nie.
  **Mehrere Löcher finden einander**: Sie ziehen sich gegenseitig an und
  **verschmelzen**, wenn sich ihre Horizonte überlappen – das größere frisst das
  kleinere (Schockwelle + Flash + Screen-Shake). Ein senkrechter **Photonen-Halo**
  (zwei sich kreuzende Ringe) liefert den großen Linsen-Effekt à la Gargantua.
- **Krater ohne Treibgut** – Explosionen graben echte Löcher, lassen aber keine
  Blöcke schwebend in der Luft zurück (schwebende Überhänge werden entfernt).
- **Kanone** – feuert mit echtem Rückstoß.
- **TNT** – Explosionen mit Impuls **und** sie graben echte Krater ins Terrain.

### 💧 Wasser (Zelluläre Automaten)
- Wasserquellen füllen sich und breiten sich aus (Mengen-Modell, 1–8 pro Zelle).
- **Verdunstung + Budget** – das Wasser flutet nie unendlich.
- **Auftrieb** – Blöcke treiben im Wasser.
- **Regen** (G) – füllt die Welt für 8 Sekunden.

### 💥 Chaos
- **Laser-Waffe** (L) mit Strahl, Auto-Fire, Screen-Shake & Flash.
- **Zeitlupe** (B) – 4× langsamer.
- **Windböe** (T) – holt dir Blöcke um die Ohren.
- **Alle Kanonen** (C) – ein Schuss, alles fliegt.
- **Push** (E) – Knallimpuls.

### 🌗 Atmosphäre
- **Tag/Nacht-Zyklus** (N): Sonne ↔ Mond, Himmel-Verlauf, Sterne, Nebel-Farbe –
  sanfte ~2s-Überblendung.
- **Ziel-Hhighlight** – pulsierender Rahmen um den Block/die Zelle, auf die du zielst.
- **Ambient Occlusion** – gebackenes, pro-Instanz AO (Blöcke & Terrain verdunkeln
  sich in Ecken/Kontakten; echte Blöcke in der Luft bleiben hell).
- **Candy-Diorama-Look** – abgerundete Blöcke, Pastell-Palette, Himmel-Dome,
  weiche Wolken, Sonne/Mond-Glow, Podest. *(Absichtlich kein Minecraft-Look.)*

### 🛋️ Komfort
- **Undo** (Strg+Z) – Voll-Snapshots (Grid + Wasser + Blöcke), 40 Schritte.
- **Save/Load** (Strg+S / Strg+L) – kompletter Weltzustand + Tagesphase + Gravitation
  in `localStorage` (überlebt den Reload).
- **Neue Insel** – frisches Terrain + Start-Szenario, Chaos vergessen.
- **Screenshot** (P) – PNG-Download.

### 🔊 Ton (WebAudio, synthetisiert)
Alle Sounds (Pop, Laser, Bombe, Kanone, Wind, Wasser, …) werden zur Laufzeit per
WebAudio-API synthetisiert – **keine Audiodateien, keine Assets**.

---

## 🏁 Start-Szenario
Zum Start gibt’s direkt was zu tun: ein Teich mit Wasserquelle, ein Stein-Turm mit
TNT-Gipfel, Gummiböden, eine Eisbahn, eine TNT-Reihe – **und ein Stein, der dir sofort
auf den Turm fliegt.**

---

## 🛠️ Tech-Stack
| Baustein | Technologie |
|---|---|
| Rendering | **WebGPU** via `three.js` r185 `WebGPURenderer` |
| Physik | **Rapier 3D** (WASM, `@dimforge/rapier3d-compat` 0.20) |
| Bundle | **Vite** |
| Ton | **Web Audio API** (prozedural) |
| Assets | **Keine** – alles prozedural (Geometrie, Texturen, Sounds) |

### Architektur
```
src/
  main.js     Szene, Eingabe, Aktionen, Undo/Save, Tag/Nacht, AO, Animation-Loop
  world.js    Voxel-Grid, Terrain, Spalten-Collider, Raycast
  water.js    Wasser-Zelluläre-Automaten (Mengen-Modell + Auftrieb)
  blocks.js   Block-Typen, Massen, Palette, PLACEABLE-Order
  particles.js  Partikel-System
  sound.js    WebAudio-Synthese
test/
  smoke.mjs   Init, Explosion, Grav-Flip, Push, TNT
  chaos.mjs   Kanone, Schwarzes Loch (langsam + wächst, keine Explosion), Zeitlupe
  bh2.mjs     Schwarze-Löcher-Verschmelzung (zwei Löcher, drittes bleibt unversehrt)
  touch.mjs   Mobile Touch-Controls (Joystick, Tap-Place, Laser, Zoom)
  perf.mjs    Performance-Budget + adaptiver Crash-Schutz (Ruhe vs. Chaos, Cuts greifen)
  toys.mjs    Ballon, Kette, Wind, Regen
  atmo.mjs    Tag/Nacht, Screenshot, Ziel-Highlight, AO
  comf.mjs    Undo, Save/Load, Neue Insel
```

### Tests
```bash
npm run dev          # Dev-Server läuft (Test setzen ihn voraus)
node test/smoke.mjs  # o. ein anderes Test-Skript
```
Die Tests fahren die Seite headless (Chromium + SwiftShader-WebGPU) und verifizieren,
dass **jede** Physik-/Spiel-Funktion wirklich funktioniert.

---

## 🧪 Bekannte Headless-Artefakte (keine Bugs)
Unter SwiftShader/Lavapipe (CPU-WebGPU) bleibt das Rendering-Backbuffer manchmal weiß
in Screenshots und es erscheinen `popErrorScope`/`createBuffer`-Konsoleinträge beim
Shutdown. Beides sind **Umgebungsartefakte** der Software-Rasterisierung, keine Fehler
des Spiels. In einem echten Browser mit GPU rendern und laufen alle Features korrekt.
