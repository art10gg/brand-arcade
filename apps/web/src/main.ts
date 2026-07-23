import Phaser from "phaser";
import { AudioSettings, applyBrandTheme, loadBrand, type BrandManifest } from "@platform/core";
import { PlatformerScene } from "@platform/game-platformer";
import { KartScene, TRACKS } from "@platform/game-kart";

/**
 * PWA-Shell: lädt das Brand-Manifest (?brand=<id>, Default: demo-brand),
 * themed das Menü in Markenfarben, bietet Strecken-Auswahl fürs Kart-Rennen
 * und ein Optionsmenü (Ton/Musik, Steuerung) an, dann startet das Spiel.
 */
async function boot() {
  const params = new URLSearchParams(location.search);
  const brandId = params.get("brand") ?? "demo-brand";

  let brand: BrandManifest;
  try {
    brand = await loadBrand(brandId);
  } catch (e) {
    document.getElementById("brand-sub")!.textContent = `Fehler: ${(e as Error).message}`;
    return;
  }

  applyBrandTheme(brand);
  document.title = `${brand.name} Arcade`;
  document.getElementById("brand-title")!.textContent = `${brand.name} Arcade`;

  document.querySelector<HTMLButtonElement>('button[data-game="platformer"]')!
    .addEventListener("click", () => startGame(brand, "platformer"));

  setupTrackSelection(brand);
  setupOptionsMenu();
}

/** Klick auf "Kart-Rennen" → Streckenwahl statt sofortigem Start. */
function setupTrackSelection(brand: BrandManifest) {
  const mainButtons = document.getElementById("main-buttons")!;
  const trackList = document.getElementById("track-list")!;
  const kartBtn = document.getElementById("kart-btn")!;
  const backBtn = document.getElementById("back-btn")!;

  for (const track of TRACKS) {
    const btn = document.createElement("button");
    btn.className = "track-btn";
    btn.innerHTML = `<span class="track-swatch" style="background:#${track.groundColor.toString(16).padStart(6, "0")}"></span><span>${track.name}</span>`;
    btn.addEventListener("click", () => startGame(brand, "kart", track.id));
    trackList.insertBefore(btn, backBtn);
  }

  kartBtn.addEventListener("click", () => {
    mainButtons.style.display = "none";
    trackList.style.display = "block";
  });
  backBtn.addEventListener("click", () => {
    trackList.style.display = "none";
    mainButtons.style.display = "block";
  });
}

/** Optionen-Zahnrad: Ton/Musik-Schalter (persistent) + Steuerungs-Übersicht. */
function setupOptionsMenu() {
  const overlay = document.getElementById("options-overlay")!;
  const openBtn = document.getElementById("options-btn")!;
  const closeBtn = document.getElementById("options-close")!;
  const soundToggle = document.getElementById("sound-toggle") as HTMLInputElement;
  const musicToggle = document.getElementById("music-toggle") as HTMLInputElement;

  soundToggle.checked = AudioSettings.soundEnabled;
  musicToggle.checked = AudioSettings.musicEnabled;

  openBtn.addEventListener("click", () => overlay.classList.add("open"));
  closeBtn.addEventListener("click", () => overlay.classList.remove("open"));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("open"); });

  soundToggle.addEventListener("change", () => { AudioSettings.soundEnabled = soundToggle.checked; });
  musicToggle.addEventListener("change", () => { AudioSettings.musicEnabled = musicToggle.checked; });
}

let activeGame: Phaser.Game | null = null;

function startGame(brand: BrandManifest, game: "platformer" | "kart", trackId?: string) {
  document.getElementById("menu")!.style.display = "none";
  document.getElementById("options-btn")!.style.display = "none";
  const container = document.getElementById("game")!;
  container.style.display = "block";

  activeGame?.destroy(true);
  const SceneClass = game === "platformer" ? PlatformerScene : KartScene;
  activeGame = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    width: 960,
    height: 600,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    // KEIN globales pixelArt: es rundet alle Positionen auf ganze Pixel und
    // lässt langsam bewegte Sprites (Kart-Szenerie) sichtbar ruckeln.
    // Der Plattformer setzt Pixel-Look gezielt per NEAREST-Filter + Kamera-Rundung.
    // Mipmapping: verhindert Textur-Flimmern/-Krabbeln bei stark verkleinerten,
    // weit entfernten Sprites (Bäume/Banden) — ein GPU-Sampling-Effekt, der
    // sich als "Ruckeln" genau bei den kleinsten/fernsten Objekten zeigt.
    antialias: true,
    mipmapFilter: "LINEAR_MIPMAP_LINEAR",
    physics: { default: "arcade", arcade: { gravity: { x: 0, y: 900 } } },
    backgroundColor: "#1b1b24",
  });
  activeGame.scene.add(game, SceneClass, true, { brand, trackId });
}

boot();

// Offline-Fähigkeit (PWA): Service Worker nur im Build/HTTPS-Kontext
if ("serviceWorker" in navigator && !location.hostname.includes("localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {/* optional */});
}
