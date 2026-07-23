import Phaser from "phaser";

/** Sound-Effekte (Kenney CC0). In preload() laden, danach via sfx() abspielen. */
export const SFX_FILES = [
  "jump", "coin", "stomp", "hit", "bounce",
  "item", "boost", "zap", "beep", "go",
  "win", "finish", "gameover",
] as const;
export type SfxKey = (typeof SFX_FILES)[number];

const LS_SOUND = "arcade-sound-enabled";
const LS_MUSIC = "arcade-music-enabled";

/**
 * Persistente Ton-/Musik-Einstellungen (localStorage-gestützt), global für
 * die ganze Plattform. Vom Optionsmenü im Startbildschirm gesetzt; sfx(),
 * EngineSound und playMusic() respektieren sie automatisch.
 */
export const AudioSettings = {
  get soundEnabled(): boolean {
    return localStorage.getItem(LS_SOUND) !== "off";
  },
  set soundEnabled(v: boolean) {
    localStorage.setItem(LS_SOUND, v ? "on" : "off");
  },
  get musicEnabled(): boolean {
    return localStorage.getItem(LS_MUSIC) !== "off";
  },
  set musicEnabled(v: boolean) {
    localStorage.setItem(LS_MUSIC, v ? "on" : "off");
  },
};

export function preloadSfx(scene: Phaser.Scene, keys: readonly SfxKey[]): void {
  for (const k of keys) scene.load.audio(`sfx-${k}`, `assets/audio/${k}.ogg`);
}

export function sfx(scene: Phaser.Scene, key: SfxKey, volume = 0.5): void {
  if (!AudioSettings.soundEnabled) return;
  try {
    scene.sound.play(`sfx-${key}`, { volume });
  } catch {
    /* Audio darf nie das Spiel crashen */
  }
}

/**
 * Loop-Hintergrundmusik (Kenney-Jingle als Loop). Eine Szene lädt sie in
 * preload() unter `music-key` und startet sie in create() — respektiert
 * AudioSettings.musicEnabled und wird beim Szenenwechsel automatisch gestoppt.
 */
export function preloadMusic(scene: Phaser.Scene, key: string): void {
  scene.load.audio(`music-${key}`, `assets/audio/music-${key}.ogg`);
}

export function playMusic(scene: Phaser.Scene, key: string, volume = 0.25): Phaser.Sound.BaseSound | null {
  try {
    const sound = scene.sound.add(`music-${key}`, { loop: true, volume });
    if (AudioSettings.musicEnabled) sound.play();
    const onSettingsPoll = scene.time.addEvent({
      delay: 400,
      loop: true,
      callback: () => {
        if (AudioSettings.musicEnabled && !sound.isPlaying) sound.play();
        if (!AudioSettings.musicEnabled && sound.isPlaying) sound.stop();
      },
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { sound.stop(); onSettingsPoll.remove(); });
    scene.events.once(Phaser.Scenes.Events.DESTROY, () => { sound.stop(); onSettingsPoll.remove(); });
    return sound;
  } catch {
    return null;
  }
}

/**
 * Synthetischer Kart-Motor (WebAudio): Sägezahn + Tiefpass,
 * Tonhöhe folgt der Geschwindigkeit. Kein Asset nötig, läuft überall.
 * Respektiert AudioSettings.soundEnabled (zählt als "Ton", nicht "Musik").
 */
export class EngineSound {
  private osc?: OscillatorNode;
  private gain?: GainNode;
  private ctx?: AudioContext;

  start(scene: Phaser.Scene): void {
    const mgr = scene.sound as Phaser.Sound.WebAudioSoundManager;
    if (!mgr.context) return;
    this.ctx = mgr.context;
    this.osc = this.ctx.createOscillator();
    this.osc.type = "sawtooth";
    this.osc.frequency.value = 55;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 320;
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.osc.connect(filter).connect(this.gain).connect(this.ctx.destination);
    this.osc.start();
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.stop());
    scene.events.once(Phaser.Scenes.Events.DESTROY, () => this.stop());
  }

  /** speed01: 0..1, boost hebt die Tonhöhe zusätzlich an. */
  update(speed01: number, boosting = false): void {
    if (!this.osc || !this.gain || !this.ctx) return;
    const t = this.ctx.currentTime;
    const freq = 55 + speed01 * 130 + (boosting ? 40 : 0);
    const targetGain = !AudioSettings.soundEnabled ? 0 : speed01 > 0.01 ? 0.035 + speed01 * 0.035 : 0;
    this.osc.frequency.setTargetAtTime(freq, t, 0.06);
    this.gain.gain.setTargetAtTime(targetGain, t, 0.1);
  }

  stop(): void {
    try {
      this.gain?.gain.setValueAtTime(0, this.ctx?.currentTime ?? 0);
      this.osc?.stop();
    } catch { /* bereits gestoppt */ }
    this.osc = undefined;
  }
}
