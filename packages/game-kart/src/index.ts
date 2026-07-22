import Phaser from "phaser";
import {
  BrandManifest,
  EngineSound,
  avatarKey,
  createAvatar,
  playAvatarAnim,
  preloadAvatar,
  preloadSfx,
  sfx,
} from "@platform/core";

/**
 * Kart-Racer im SuperTuxKart-Stil, Pseudo-3D:
 * - Perspektivisch korrekte Projektion (z = NEAR·(1-p)/p) → kein Streifen-Flackern
 * - Strecke aus Segmenten, 3 Runden, 3 KI-Gegner, Items, Boost-Pads, Drift
 * - Optik: Himmel-Gradient, Hügel-Silhouette, Bäume am Streckenrand, Kart-Schatten
 */

const DRAW_DIST = 2600;
const NEAR = 300; // Projektionskonstante: Skalierung = NEAR/(NEAR+z)
const LAPS = 3;
const MAX_SPEED = 900;
const OFFROAD_SPEED = 250;
const STRIPE_LEN = 220;

/** Streckendesign: [Länge, Kurvenstärke]. Negativ = links. Runde ≈ 16,4 km. */
const TRACK_SEGMENTS: [number, number][] = [
  [900, 0], [700, 1.2], [500, 0], [800, -1.6], [400, 0], [600, 0.8],
  [600, -0.8], [1000, 0], [700, 1.8], [500, 0], [600, -1.0], [700, 0],
  [800, 0.6], [900, 0], [700, -1.4], [500, 0], [600, 1.0], [800, 0],
  [600, -0.6], [900, 1.5], [400, 0], [700, -1.8], [600, 0], [900, 0],
];
const TRACK_LENGTH = TRACK_SEGMENTS.reduce((s, [len]) => s + len, 0);

/** Lateral-Einheit: -1 = linker Streckenrand, +1 = rechter Streckenrand. */
const ITEM_BOXES: { d: number; x: number }[] = [
  { d: 1100, x: -0.5 }, { d: 1160, x: 0 }, { d: 1220, x: 0.5 },
  { d: 3900, x: -0.4 }, { d: 3960, x: 0.4 },
  { d: 6200, x: -0.5 }, { d: 6260, x: 0 }, { d: 6320, x: 0.5 },
  { d: 9500, x: -0.5 }, { d: 9560, x: 0 }, { d: 9620, x: 0.5 },
  { d: 12300, x: -0.4 }, { d: 12360, x: 0.4 },
  { d: 14800, x: -0.5 }, { d: 14860, x: 0 }, { d: 14920, x: 0.5 },
];
const BOOST_PADS: { d: number; x: number }[] = [
  { d: 2900, x: 0 }, { d: 5300, x: -0.35 }, { d: 7300, x: 0.25 },
  { d: 10400, x: 0 }, { d: 13500, x: 0.3 }, { d: 15600, x: -0.3 },
];

/** Werbebanden am Streckenrand (White-Label-Werbefläche!). */
const BILLBOARDS: { d: number; side: number }[] = [
  { d: 500, side: 1 }, { d: 1500, side: -1 }, { d: 2600, side: 1 },
  { d: 3600, side: -1 }, { d: 4800, side: 1 }, { d: 6000, side: -1 }, { d: 7100, side: 1 },
  { d: 8600, side: -1 }, { d: 9800, side: 1 }, { d: 11000, side: -1 },
  { d: 12400, side: 1 }, { d: 13600, side: -1 }, { d: 15000, side: 1 }, { d: 16000, side: -1 },
];

type ItemKind = "turbo" | "shield" | "zap";
const ITEM_LABEL: Record<ItemKind, string> = { turbo: "🚀 Turbo", shield: "🛡 Schild", zap: "⚡ Blitz" };

interface Opponent {
  dist: number;
  lateral: number;
  speed: number;
  baseSpeed: number;
  slowUntil: number;
  sprite: Phaser.GameObjects.Image;
}

export class KartScene extends Phaser.Scene {
  private brand!: BrandManifest;
  private kart!: Phaser.GameObjects.Sprite;
  private kartShadow!: Phaser.GameObjects.Ellipse;
  private road!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Graphics;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private driftKey!: Phaser.Input.Keyboard.Key;
  private itemKey!: Phaser.Input.Keyboard.Key;

  private dist = 0;
  private prevDist = 0;
  private speed = 0;
  private playerX = 0;
  private lap = 1;
  private finished = false;
  private countdownUntil = 0;

  private item: ItemKind | null = null;
  private turboUntil = 0;
  private shieldUntil = 0;
  private drifting = false;
  private driftCharge = 0;
  private collectedBoxes = new Set<number>();

  private opponents: Opponent[] = [];
  private hud!: Phaser.GameObjects.Text;
  private itemHud!: Phaser.GameObjects.Text;
  private engine = new EngineSound();
  private pano!: Phaser.GameObjects.TileSprite;
  private bgScroll = 0;
  private treePool: Phaser.GameObjects.Image[] = [];
  private billboardPool: Phaser.GameObjects.Image[] = [];

  constructor() {
    super("kart");
  }

  init(data: { brand?: BrandManifest }) {
    if (data.brand) this.brand = data.brand;
    this.dist = 0; this.prevDist = 0; this.speed = 0; this.playerX = 0;
    this.lap = 1; this.finished = false; this.item = null;
    this.turboUntil = 0; this.shieldUntil = 0; this.driftCharge = 0;
    this.opponents = [];
    this.collectedBoxes.clear();
    this.bgScroll = 0;
    this.treePool = [];
    this.billboardPool = [];
  }

  preload() {
    preloadAvatar(this, this.brand, "kart");
    preloadSfx(this, ["beep", "go", "item", "boost", "zap", "hit", "finish", "coin"]);
    this.load.image("kart-pano", "assets/kart/panorama.jpg");
    this.load.image("kart-tree-0", "assets/kart/tree-0.png");
    this.load.image("kart-tree-1", "assets/kart/tree-1.png");
    this.load.image("kart-tree-2", "assets/kart/tree-2.png");
    this.load.image("kart-opp-0", "assets/kart/opp-green.png");
    this.load.image("kart-opp-1", "assets/kart/opp-blue.png");
    this.load.image("kart-opp-2", "assets/kart/opp-purple.png");
  }

  create() {
    createAvatar(this, this.brand, "kart");
    const { width, height } = this.scale;
    const horizon = height * 0.42;

    // Gemaltes Panorama (KI-generiert, horizontal kachelbar) mit Kurven-Parallaxe
    this.pano = this.add.tileSprite(width / 2, horizon / 2, width, horizon, "kart-pano").setDepth(0);
    const panoTex = this.textures.get("kart-pano").getSourceImage();
    const panoScale = horizon / panoTex.height;
    this.pano.setTileScale(panoScale, panoScale);

    // Werbebande in Markenfarben mit Markennamen (White-Label-Werbefläche)
    this.makeBillboardTexture();

    // Sprite-Pools für Streckendeko
    for (let i = 0; i < 16; i++) {
      this.treePool.push(this.add.image(0, 0, "kart-tree-0").setVisible(false).setOrigin(0.5, 1));
    }
    for (let i = 0; i < 6; i++) {
      this.billboardPool.push(this.add.image(0, 0, "billboard").setVisible(false).setOrigin(0.5, 1));
    }

    this.road = this.add.graphics().setDepth(1);
    this.overlay = this.add.graphics().setDepth(5);

    // KI-Gegner: Startaufstellung sichtbar direkt vor dem Spieler (Rennstart-Grid)
    for (let i = 0; i < 3; i++) {
      const s = this.add.image(0, 0, `kart-opp-${i}`).setVisible(false).setDepth(4).setOrigin(0.5, 1);
      this.opponents.push({
        dist: 55 + i * 55,                        // gestaffeltes Grid, alle im Blickfeld
        lateral: [-0.5, 0.5, 0][i],               // versetzt neben der Ideallinie
        speed: 0,
        baseSpeed: MAX_SPEED * (0.8 + i * 0.04),  // 720–792 < 900 → fair schlagbar
        slowUntil: 0,
        sprite: s,
      });
    }

    this.kartShadow = this.add.ellipse(width / 2, height - 44, 120, 20, 0x000000, 0.3).setDepth(6);
    this.kart = this.add.sprite(width / 2, height - 70, avatarKey("kart")).setDepth(7);
    this.kart.setScale(150 / this.kart.width); // Zielbreite ~150 px, unabhängig von Asset-Größe
    playAvatarAnim(this.kart, "kart", "drive");

    this.hud = this.add
      .text(16, 12, "", { fontFamily: "system-ui, sans-serif", fontSize: "18px", color: "#ffffff" })
      .setShadow(1, 1, "#00000088", 2).setDepth(10);
    this.itemHud = this.add
      .text(width - 16, 12, "", { fontFamily: "system-ui, sans-serif", fontSize: "22px", color: "#ffffff" })
      .setOrigin(1, 0).setShadow(1, 1, "#00000088", 2).setDepth(10);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.driftKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.X);
    this.itemKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this.input.addPointer(1);
    const setTouch = (p: Phaser.Input.Pointer) => {
      if (p.y < 80 && p.x > width - 180) { this.useItem(); return; }
      this.registry.set("touch-x", p.isDown ? p.x : null);
    };
    this.input.on("pointerdown", setTouch);
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => p.isDown && setTouch(p));
    this.input.on("pointerup", () => this.registry.set("touch-x", null));

    this.engine.start(this);

    // Countdown
    this.countdownUntil = this.time.now + 3000;
    const cd = this.add
      .text(width / 2, height / 2, "3", { fontFamily: "system-ui, sans-serif", fontSize: "96px", color: "#ffffff" })
      .setOrigin(0.5).setDepth(11).setShadow(2, 2, "#000000aa", 4);
    this.time.addEvent({
      delay: 1000, repeat: 3,
      callback: () => {
        const left = Math.ceil((this.countdownUntil - this.time.now) / 1000);
        if (left > 0) { cd.setText(String(left)); sfx(this, "beep", 0.4); }
        else { cd.setText("LOS!"); sfx(this, "go", 0.5); this.time.delayedCall(600, () => cd.destroy()); }
      },
    });
  }

  /** Bande: weißer Rahmen, Fläche in Markenfarbe, Markenname — auf Holzpfosten. */
  private makeBillboardTexture(): void {
    if (this.textures.exists("billboard")) this.textures.remove("billboard");
    const w = 260, h = 170, boardH = 120;
    const rt = this.make.renderTexture({ width: w, height: h }, false);
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x7a5230, 1);
    g.fillRect(34, boardH - 6, 18, h - boardH + 6);
    g.fillRect(w - 52, boardH - 6, 18, h - boardH + 6);
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(0, 0, w, boardH, 12);
    g.fillStyle(Phaser.Display.Color.HexStringToColor(this.brand.colors.primary).color, 1);
    g.fillRoundedRect(9, 9, w - 18, boardH - 18, 8);
    rt.draw(g, 0, 0);
    const txt = this.make.text({
      x: 0, y: 0, text: this.brand.name,
      style: { fontFamily: "system-ui, sans-serif", fontSize: "36px", fontStyle: "bold", color: "#ffffff" },
    }, false).setOrigin(0.5);
    rt.draw(txt, w / 2, boardH / 2);
    rt.saveTexture("billboard");
    txt.destroy();
    g.destroy();
    rt.destroy();
  }

  // ── Strecken-Mathematik ───────────────────────────────────────

  private curveAt(d: number): number {
    let pos = ((d % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
    for (let i = 0; i < TRACK_SEGMENTS.length; i++) {
      const [len, curve] = TRACK_SEGMENTS[i];
      if (pos < len) {
        const t = pos / len;
        if (t < 0.15) {
          const [, prev] = TRACK_SEGMENTS[(i - 1 + TRACK_SEGMENTS.length) % TRACK_SEGMENTS.length];
          return Phaser.Math.Linear(prev, curve, t / 0.15);
        }
        if (t > 0.85) {
          const [, next] = TRACK_SEGMENTS[(i + 1) % TRACK_SEGMENTS.length];
          return Phaser.Math.Linear(curve, next, (t - 0.85) / 0.15);
        }
        return curve;
      }
      pos -= len;
    }
    return 0;
  }

  /** Signierter Abstand Objekt↔Spieler, rundenzyklisch auf ±halbe Runde normiert. */
  private gapTo(objDist: number): number {
    const raw = (((objDist - this.dist) % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH; // 0..T
    return raw > TRACK_LENGTH / 2 ? raw - TRACK_LENGTH : raw;
  }

  /** Hat der Spieler in diesem Frame die Runden-Position `d` durchfahren? */
  private crossed(d: number): boolean {
    const T = TRACK_LENGTH;
    const a = ((this.prevDist % T) + T) % T;
    const b = ((this.dist % T) + T) % T;
    return a <= b ? d > a && d <= b : d > a || d <= b;
  }

  /** Zeilen-Cache des aktuellen Frames (von renderRoad befüllt). */
  private rows: { z: number; center: number; w: number; p: number; y: number }[] = [];
  private horizonY = 0;
  /** Höhe einer Renderzeile in px (fein = flüssige Sprite-Bewegung). */
  private static readonly ROW_STEP = 2;

  /**
   * Weiche Projektion für Sprites: kontinuierliches y/p und zwischen den
   * Renderzeilen INTERPOLIERTE Streckenmitte/-breite — kein Raster-Ruckeln.
   */
  private projectSmooth(z: number) {
    if (!this.rows.length) return null;
    const { height } = this.scale;
    const p = NEAR / (NEAR + z);
    const y = this.horizonY + (height - this.horizonY) * p;
    const fidx = (height - y) / KartScene.ROW_STEP;
    const i0 = Math.floor(fidx);
    if (i0 < 0 || i0 >= this.rows.length) return null;
    const i1 = Math.min(i0 + 1, this.rows.length - 1);
    const t = Phaser.Math.Clamp(fidx - i0, 0, 1);
    const a = this.rows[i0];
    const b = this.rows[i1];
    return {
      p,
      y,
      center: a.center + (b.center - a.center) * t,
      w: a.w + (b.w - a.w) * t,
    };
  }

  // ── Hauptschleife ─────────────────────────────────────────────

  update(_t: number, dtMs: number) {
    const dt = Math.min(dtMs / 1000, 0.05);
    const { width, height } = this.scale;
    const horizon = height * 0.42;
    const now = this.time.now;
    const racing = now > this.countdownUntil && !this.finished;

    // Eingabe
    const touchX = this.registry.get("touch-x") as number | null;
    const accelerating = racing && (this.cursors.up.isDown || touchX != null);
    const steer =
      (this.cursors.left.isDown || (touchX != null && touchX < width / 2) ? -1 : 0) +
      (this.cursors.right.isDown || (touchX != null && touchX >= width / 2) ? 1 : 0);
    if (Phaser.Input.Keyboard.JustDown(this.itemKey)) this.useItem();

    // Drift & Mini-Turbo
    const wantDrift = this.driftKey.isDown && steer !== 0 && this.speed > MAX_SPEED * 0.5;
    if (wantDrift) {
      this.drifting = true;
      this.driftCharge = Math.min(this.driftCharge + dt, 1.6);
    } else {
      if (this.drifting && this.driftCharge > 0.8) {
        this.turboUntil = Math.max(this.turboUntil, now + 900);
        sfx(this, "boost", 0.4);
      }
      this.drifting = false;
      this.driftCharge = 0;
    }

    // Fahrphysik
    const boosting = now < this.turboUntil;
    const topSpeed = boosting ? MAX_SPEED * 1.3 : MAX_SPEED;
    const accel = accelerating ? (boosting ? 1000 : 600) : -500;
    this.speed = Phaser.Math.Clamp(this.speed + accel * dt, 0, topSpeed);
    if (Math.abs(this.playerX) > 1 && !boosting) this.speed = Math.min(this.speed, OFFROAD_SPEED);

    this.prevDist = this.dist;
    this.dist += this.speed * dt;
    const curve = this.curveAt(this.dist);
    const steerPower = this.drifting ? 2.4 : 1.6;
    this.playerX = Phaser.Math.Clamp(
      this.playerX + steer * steerPower * dt - curve * (this.speed / MAX_SPEED) * 0.9 * dt,
      -1.6, 1.6
    );

    // Runden & Ziel
    if (racing && Math.floor(this.prevDist / TRACK_LENGTH) < Math.floor(this.dist / TRACK_LENGTH)) {
      this.lap += 1;
      this.collectedBoxes.clear();
      if (this.lap > LAPS) this.finishRace();
    }

    // Items & Boost-Pads: Durchfahrts-Check (kein Verpassen bei hohem Tempo)
    for (const box of ITEM_BOXES) {
      if (this.collectedBoxes.has(box.d)) continue;
      if (this.crossed(box.d) && Math.abs(this.playerX - box.x) < 0.45) {
        this.collectedBoxes.add(box.d);
        sfx(this, "coin", 0.35);
        if (!this.item) {
          const pool: ItemKind[] = ["turbo", "shield", "zap"];
          this.item = pool[Math.floor(Math.random() * pool.length)];
        }
      }
    }
    for (const pad of BOOST_PADS) {
      if (this.crossed(pad.d) && Math.abs(this.playerX - pad.x) < 0.5) {
        if (now >= this.turboUntil) sfx(this, "boost", 0.35);
        this.turboUntil = Math.max(this.turboUntil, now + 700);
      }
    }

    // KI-Gegner: moderates Rubber-Banding, blockiert Überholen nicht mehr
    for (const opp of this.opponents) {
      const gap = this.gapTo(opp.dist);
      // Enges Pack-Racing: Feld bleibt beisammen → keine Überrundungen,
      // Anzeige-Position und sichtbare Karts decken sich immer.
      let target = opp.baseSpeed;
      if (gap < -400) target *= 1.12; // hinter dem Spieler → aufholen
      if (gap > 400) target *= 0.85;  // vor dem Spieler → bremsen
      if (now < opp.slowUntil) target *= 0.35;
      if (!racing && !this.finished) target = 0;
      // Beschleunigung wie beim Spieler (600/s) statt Sofort-Tempo → fairer Start
      const dv = Phaser.Math.Clamp(target - opp.speed, -800 * dt, 600 * dt);
      opp.speed = Math.max(0, opp.speed + dv);
      opp.dist += opp.speed * dt;
      const oppCurve = this.curveAt(opp.dist);
      opp.lateral = Phaser.Math.Linear(opp.lateral, Phaser.Math.Clamp(-oppCurve * 0.4, -0.6, 0.6), 0.5 * dt);

      // Kollision: kurzer Rempler + Seitenversatz statt Dauerbremse
      if (racing && Math.abs(gap) < 40 && Math.abs(opp.lateral - this.playerX) < 0.22) {
        if (now < this.shieldUntil || boosting) {
          opp.slowUntil = now + 1200;
        } else {
          if (this.speed > opp.speed) sfx(this, "hit", 0.3);
          this.speed = Math.min(this.speed, Math.max(opp.speed * 0.95, this.speed * 0.85));
          this.playerX += this.playerX > opp.lateral ? 0.3 : -0.3;
          playAvatarAnim(this.kart, "kart", "hit");
        }
      }
    }

    this.engine.update(this.finished ? 0 : this.speed / MAX_SPEED, boosting);

    // Panorama-Parallaxe: Hintergrund wandert in Kurven gegenläufig mit
    this.bgScroll += curve * this.speed * dt * 0.06;
    this.pano.tilePositionX = this.bgScroll + this.playerX * 14;

    this.renderRoad(width, height, horizon, curve, now);

    // Kart & HUD
    this.kart.setX(width / 2 + this.playerX * 30).setAngle(steer * (this.drifting ? 16 : 8));
    this.kartShadow.setX(this.kart.x);
    if (this.drifting) playAvatarAnim(this.kart, "kart", steer < 0 ? "drift-left" : "drift-right");
    else if (boosting) playAvatarAnim(this.kart, "kart", "boost");
    else playAvatarAnim(this.kart, "kart", "drive");
    this.kart.setTint(now < this.shieldUntil ? 0x9ad0ff : 0xffffff);

    const rank = 1 + this.opponents.filter((o) => o.dist > this.dist).length;
    this.hud.setText(
      `${this.brand.name}  |  Runde ${Math.min(this.lap, LAPS)}/${LAPS}  |  Platz ${rank}/${this.opponents.length + 1}  |  ${Math.round(this.speed / 9)} km/h${this.drifting ? "  |  DRIFT" : ""}`
    );
    this.itemHud.setText(this.item ? `${ITEM_LABEL[this.item]} [SPACE]` : "");
  }

  private useItem() {
    if (!this.item || this.finished) return;
    const now = this.time.now;
    if (this.item === "turbo") { this.turboUntil = now + 1600; sfx(this, "boost", 0.45); }
    if (this.item === "shield") { this.shieldUntil = now + 8000; sfx(this, "item", 0.45); }
    if (this.item === "zap") {
      sfx(this, "zap", 0.45);
      const ahead = this.opponents
        .map((o) => ({ o, gap: this.gapTo(o.dist) }))
        .filter(({ gap }) => gap > 0)
        .sort((a, b) => a.gap - b.gap)[0];
      if (ahead) ahead.o.slowUntil = now + 2500;
    }
    this.item = null;
  }

  private finishRace() {
    this.finished = true;
    sfx(this, "finish", 0.5);
    this.engine.update(0);
    const rank = 1 + this.opponents.filter((o) => o.dist > this.dist).length;
    const { width, height } = this.scale;
    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.6).setDepth(11);
    this.add
      .text(width / 2, height / 2 - 20, rank === 1 ? "🏆 Sieg!" : `Ziel! Platz ${rank}`, {
        fontFamily: "system-ui, sans-serif", fontSize: "42px", color: "#ffffff",
      })
      .setOrigin(0.5).setDepth(12);
    this.add
      .text(width / 2, height / 2 + 34, "Tippen / Taste für Neustart", {
        fontFamily: "system-ui, sans-serif", fontSize: "18px", color: "#cccccc",
      })
      .setOrigin(0.5).setDepth(12);
    this.time.delayedCall(600, () => {
      this.input.once("pointerdown", () => this.scene.restart({ brand: this.brand }));
      this.input.keyboard!.once("keydown", () => this.scene.restart({ brand: this.brand }));
    });
  }

  // ── Rendering ─────────────────────────────────────────────────

  /**
   * Perspektivisch korrekte Zeilen-Projektion: pro 3-px-Bildzeile wird der
   * Weltabstand z = NEAR·(1-p)/p bestimmt. Dadurch ist die Zuordnung
   * Bildzeile → Streckenposition stetig → kein Flackern der Streifen.
   */
  private renderRoad(width: number, height: number, horizon: number, curve: number, now: number) {
    const g = this.road;
    g.clear();
    const accent = Phaser.Display.Color.HexStringToColor(this.brand.colors.accent).color;
    const step = KartScene.ROW_STEP;

    const mix = (c1: number, c2: number, t: number) => {
      const r = ((c1 >> 16) & 255) + (((c2 >> 16) & 255) - ((c1 >> 16) & 255)) * t;
      const gg = ((c1 >> 8) & 255) + (((c2 >> 8) & 255) - ((c1 >> 8) & 255)) * t;
      const b = (c1 & 255) + ((c2 & 255) - (c1 & 255)) * t;
      return (Math.round(r) << 16) | (Math.round(gg) << 8) | Math.round(b);
    };
    const GRASS_FAR = 0x89bb3d; // Bodenfarbe des Panoramas → nahtloser Übergang
    const HAZE = 0x93ab84;      // Dunst für Fahrbahn/Curbs: entsättigtes Graugrün

    // Kurve wird über die Distanz INTEGRIERT (OutRun-Verfahren):
    // dadurch biegt die Straße stetig ab, statt an Segmentgrenzen zu zerreißen.
    this.horizonY = horizon;
    this.rows = [];
    let dx = 0;
    let xoff = 0;
    let prevZ = 0;

    for (let y = height; y > horizon; y -= step) {
      const p = (y - horizon) / (height - horizon); // 1 = unten/nah
      const z = NEAR * (1 - p) / p;
      if (z >= DRAW_DIST) {
        // Jenseits der Sichtweite: Panorama-Bodenfarbe — keine Projektions-Artefakte
        g.fillStyle(GRASS_FAR, 1);
        g.fillRect(0, y - step, width, step);
        continue;
      }
      const dz = z - prevZ;
      prevZ = z;
      const fog = Math.pow(z / DRAW_DIST, 1.6) * 0.75; // Distanz-Dunst
      const rowDist = this.dist + z;
      const rowLapPos = ((rowDist % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
      const stripe = Math.floor(rowDist / STRIPE_LEN) % 2 === 0;

      dx += this.curveAt(rowDist) * dz * 0.0007;
      xoff += dx * dz * 0.35;
      const proj = {
        p,
        center: width / 2 + xoff - this.playerX * p * width * 0.3,
        w: width * 0.9 * p + 30,
      };
      this.rows.push({ z, center: proj.center, w: proj.w, p, y });

      // Gras: dezente zweifarbige Streifen → Geschwindigkeitsgefühl
      g.fillStyle(mix(stripe ? 0x5aa844 : 0x52a13e, GRASS_FAR, fog), 1);
      g.fillRect(0, y - step, width, step);

      // Fahrbahn (Start/Ziel als Schachbrett-Band)
      const isFinish = rowLapPos < 50;
      if (isFinish) {
        const cells = 8;
        const cw = proj.w / cells;
        for (let c = 0; c < cells; c++) {
          g.fillStyle(mix((c + (stripe ? 0 : 1)) % 2 === 0 ? 0xf0f0f0 : 0x222222, HAZE, fog), 1);
          g.fillRect(proj.center - proj.w / 2 + c * cw, y - step, cw, step);
        }
      } else {
        // Asphalt mit leichtem Struktur-Rauschen (wirkt texturiert statt flach)
        const noise = Math.abs(Math.sin(rowDist * 12.9898) * 43758.5453 % 1);
        const asphalt = mix(stripe ? 0x4a4a55 : 0x50505c, 0x33333d, noise * 0.3);
        g.fillStyle(mix(asphalt, HAZE, fog), 1);
        g.fillRect(proj.center - proj.w / 2, y - step, proj.w, step);
        // Zwei gestrichelte Fahrspur-Linien
        if (stripe) {
          g.fillStyle(mix(0xe8e8e8, HAZE, fog), 0.75);
          g.fillRect(proj.center - proj.w * 0.27 - proj.w * 0.006, y - step, proj.w * 0.012, step);
          g.fillRect(proj.center + proj.w * 0.27 - proj.w * 0.006, y - step, proj.w * 0.012, step);
        }
      }

      // Boost-Pads als Band in Markenfarbe
      for (const pad of BOOST_PADS) {
        if (Math.abs(rowLapPos - pad.d) < 40) {
          g.fillStyle(mix(accent, HAZE, fog), 0.9);
          g.fillRect(proj.center + pad.x * proj.w * 0.5 - proj.w * 0.09, y - step, proj.w * 0.18, step);
        }
      }

      // Randstreifen (Curbs) rot/weiß
      g.fillStyle(mix(stripe ? 0xffffff : 0xd94848, HAZE, fog), 1);
      const edge = Math.max(2, 12 * p);
      g.fillRect(proj.center - proj.w / 2 - edge, y - step, edge, step);
      g.fillRect(proj.center + proj.w / 2, y - step, edge, step);
    }

    // Szenerie & schwebende Objekte (weit → nah gezeichnet)
    const ov = this.overlay;
    ov.clear();

    // Bäume/Büsche am Streckenrand: KI-Sprites aus dem Pool, perspektivisch skaliert
    let ti = 0;
    const firstTree = Math.ceil(this.dist / 170) * 170;
    for (let d = firstTree + DRAW_DIST; d >= firstTree; d -= 170) {
      const z = d - this.dist;
      if (z <= 10 || z > DRAW_DIST * 0.92 || ti >= this.treePool.length) continue;
      const proj = this.projectSmooth(z);
      if (!proj) continue;
      const n = Math.floor(d / 170);
      const type = [0, 1, 2, 0, 2, 1, 2][n % 7]; // Laubbaum/Nadelbaum/Busch gemischt
      const side = n % 2 === 0 ? -1 : 1;
      const lateral = side * (1.35 + ((n * 7) % 4) * 0.22);
      const baseH = type === 2 ? 120 : 300; // Büsche kleiner als Bäume
      const img = this.treePool[ti++];
      img
        .setTexture(`kart-tree-${type}`)
        .setVisible(true)
        .setPosition(proj.center + lateral * proj.w * 0.5, proj.y + 4)
        .setDepth(1.5 + proj.p * 1.4);
      img.setScale((baseH * proj.p) / img.height);
      ov.fillStyle(0x000000, 0.18 * proj.p);
      ov.fillEllipse(img.x, proj.y + 4, baseH * 0.5 * proj.p, baseH * 0.09 * proj.p);
    }
    for (let i = ti; i < this.treePool.length; i++) this.treePool[i].setVisible(false);

    // Werbebanden in Markenfarbe (im Pitch: „Hier steht Ihr Logo")
    let bi = 0;
    const lapPosB = ((this.dist % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
    for (const bb of BILLBOARDS) {
      if (bi >= this.billboardPool.length) break;
      const gap = (((bb.d - lapPosB) % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
      if (gap <= 10 || gap > DRAW_DIST * 0.92) continue;
      const proj = this.projectSmooth(gap);
      if (!proj) continue;
      const img = this.billboardPool[bi++];
      img
        .setVisible(true)
        .setPosition(proj.center + bb.side * 1.45 * proj.w * 0.5, proj.y + 4)
        .setDepth(1.5 + proj.p * 1.4);
      img.setScale((240 * proj.p) / img.height);
    }
    for (let i = bi; i < this.billboardPool.length; i++) this.billboardPool[i].setVisible(false);

    // Item-Boxen als pulsierende Rauten
    const lapPos = ((this.dist % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
    for (const box of ITEM_BOXES) {
      if (this.collectedBoxes.has(box.d)) continue;
      const gap = (((box.d - lapPos) % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
      if (gap <= 0 || gap > DRAW_DIST * 0.92) continue;
      const proj = this.projectSmooth(gap);
      if (!proj) continue;
      const y = proj.y;
      const x = proj.center + box.x * proj.w * 0.5;
      const size = 5 + proj.p * 24;
      const pulse = 0.85 + 0.15 * Math.sin(now / 150 + box.d);
      const pts = [
        { x, y: y - size - size }, { x: x + size, y: y - size },
        { x, y }, { x: x - size, y: y - size },
      ];
      ov.fillStyle(accent, pulse);
      ov.fillPoints(pts, true);
      ov.lineStyle(2, 0xffffff, 0.9);
      ov.strokePoints(pts, true, true);
    }

    // KI-Karts
    const sorted = [...this.opponents].sort((a, b) => this.gapTo(b.dist) - this.gapTo(a.dist));
    let depth = 3;
    for (const opp of sorted) {
      const gap = this.gapTo(opp.dist);
      if (gap <= 20 || gap > DRAW_DIST * 0.92) {
        opp.sprite.setVisible(false);
        continue;
      }
      const proj = this.projectSmooth(gap);
      if (!proj) {
        opp.sprite.setVisible(false);
        continue;
      }
      opp.sprite
        .setVisible(true)
        .setPosition(proj.center + opp.lateral * proj.w * 0.5, proj.y + 14 * proj.p)
        .setScale((0.12 + proj.p * 0.88) * (140 / opp.sprite.width))
        .setDepth(depth++);
    }
  }
}
