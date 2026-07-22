import Phaser from "phaser";

/** Sound-Effekte (Kenney CC0). In preload() laden, danach via sfx() abspielen. */
export const SFX_FILES = [
  "jump", "coin", "stomp", "hit", "bounce",
  "item", "boost", "zap", "beep", "go",
  "win", "finish", "gameover",
] as const;
export type SfxKey = (typeof SFX_FILES)[number];

export function preloadSfx(scene: Phaser.Scene, keys: readonly SfxKey[]): void {
  for (const k of keys) scene.load.audio(`sfx-${k}`, `assets/audio/${k}.ogg`);
}

export function sfx(scene: Phaser.Scene, key: SfxKey, volume = 0.5): void {
  try {
    scene.sound.play(`sfx-${key}`, { volume });
  } catch {
    /* Audio darf nie das Spiel crashen */
  }
}

/**
 * Synthetischer Kart-Motor (WebAudio): Sägezahn + Tiefpass,
 * Tonhöhe folgt der Geschwindigkeit. Kein Asset nötig, läuft überall.
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
    this.osc.frequency.setTargetAtTime(freq, t, 0.06);
    this.gain.gain.setTargetAtTime(speed01 > 0.01 ? 0.035 + speed01 * 0.035 : 0, t, 0.1);
  }

  stop(): void {
    try {
      this.gain?.gain.setValueAtTime(0, this.ctx?.currentTime ?? 0);
      this.osc?.stop();
    } catch { /* bereits gestoppt */ }
    this.osc = undefined;
  }
}
