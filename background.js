import OBR, { buildEffect } from "https://esm.run/@owlbear-rodeo/sdk@3.1.0";
import { CONTROL_CHANNEL, STRIKE_CHANNEL } from "./constants.js";

let stormTimer = null;
let stormSettings = null;
let role = "PLAYER";

const FLASH_SHADER = `
uniform shader scene;
uniform vec2 size;
uniform mat3 view;
uniform vec3 flashColor;
uniform float opacity;

half4 main(float2 coord) {
  // POST_PROCESS shaders must explicitly preserve the current scene.
  vec2 screenCoord = (vec3(coord, 1.0) * view).xy;
  half4 base = scene.eval(screenCoord);

  // Tint the existing scene instead of replacing it.
  float a = clamp(opacity, 0.0, 1.0);
  vec3 tinted = mix(base.rgb, flashColor, a * 0.58);
  vec3 lit = clamp(tinted + flashColor * a * 0.22, 0.0, 1.0);
  return half4(lit, base.a);
}
`;

const BOLT_SHADER = `
uniform shader scene;
uniform vec2 size;
uniform mat3 view;
uniform float seed;
uniform float boltX;
uniform vec3 boltColor;
uniform float opacity;

float hash1(float n) {
  return fract(sin(n * 12.9898 + seed * 78.233) * 43758.5453);
}

half4 main(float2 coord) {
  vec2 screenCoord = (vec3(coord, 1.0) * view).xy;
  half4 base = scene.eval(screenCoord);
  vec2 p = screenCoord / size;

  float segments = 18.0;
  float y = clamp(p.y, 0.0, 1.0);
  float seg = floor(y * segments);
  float t = fract(y * segments);

  float taper = 1.0 - 0.35 * y;
  float xA = boltX + (hash1(seg) - 0.5) * 0.17 * taper;
  float xB = boltX + (hash1(seg + 1.0) - 0.5) * 0.17 * taper;
  float centerX = mix(xA, xB, t);

  float d = abs(p.x - centerX);
  float core = 1.0 - smoothstep(0.0015, 0.0040, d);
  float glow = 1.0 - smoothstep(0.0040, 0.0220, d);

  float startY = 0.02;
  float endY = 0.82 + hash1(91.0) * 0.13;
  float mask = step(startY, p.y) * step(p.y, endY);

  float branchY = 0.30 + hash1(92.0) * 0.28;
  float branchLen = 0.12 + hash1(93.0) * 0.12;
  float by = (p.y - branchY) / branchLen;
  float branchMask = step(0.0, by) * step(by, 1.0);
  float direction = hash1(94.0) > 0.5 ? 1.0 : -1.0;
  float branchOrigin = boltX + (hash1(floor(branchY * segments)) - 0.5) * 0.12;
  float branchX = branchOrigin + direction * by * 0.14 + (hash1(seg + 30.0) - 0.5) * 0.025;
  float bd = abs(p.x - branchX);
  float branch = (1.0 - smoothstep(0.0015, 0.0045, bd)) * branchMask;
  float branchGlow = (1.0 - smoothstep(0.0045, 0.0140, bd)) * branchMask;

  float mainA = ((core + glow * 0.55) * mask);
  float branchA = branch * 0.8 + branchGlow * 0.3;
  float a = clamp(mainA + branchA, 0.0, 1.0) * opacity;

  // Keep the chosen hue visible, with a slightly hotter core.
  float hot = clamp(core * mask + branch * 0.7, 0.0, 1.0);
  vec3 strikeColor = mix(boltColor, vec3(1.0), hot * 0.30);
  vec3 lightAmount = clamp(strikeColor * a * 1.35, 0.0, 1.0);

  // Screen blend over the existing scene. Pixels away from the bolt are unchanged.
  vec3 outRgb = 1.0 - (1.0 - base.rgb) * (1.0 - lightAmount);
  return half4(clamp(outRgb, 0.0, 1.0), base.a);
}
`;

function hexToVec3(hex) {
  const value = hex.replace("#", "");
  const n = Number.parseInt(
    value.length === 3 ? value.split("").map((c) => c + c).join("") : value,
    16
  );
  return {
    x: ((n >> 16) & 255) / 255,
    y: ((n >> 8) & 255) / 255,
    z: (n & 255) / 255,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function addTemporaryEffect(effect, lifetimeMs) {
  const ready = await OBR.scene.isReady();
  if (!ready) return;
  await OBR.scene.local.addItems([effect]);
  await sleep(lifetimeMs);
  try {
    await OBR.scene.local.deleteItems([effect.id]);
  } catch (_) {}
}

async function flash(color, opacity, lifetimeMs = 65) {
  const effect = buildEffect()
    .name("Storm Lightning Flash")
    .effectType("VIEWPORT")
    .sksl(FLASH_SHADER)
    .uniforms([
      { name: "flashColor", value: hexToVec3(color) },
      { name: "opacity", value: opacity },
    ])
    .locked(true)
    .disableHit(true)
    .layer("POST_PROCESS")
    .blendMode("SRC_OVER")
    .build();
  return addTemporaryEffect(effect, lifetimeMs);
}

async function bolt(payload) {
  const effect = buildEffect()
    .name("Storm Lightning Bolt")
    .effectType("VIEWPORT")
    .sksl(BOLT_SHADER)
    .uniforms([
      { name: "seed", value: payload.seed ?? Math.random() * 10000 },
      { name: "boltX", value: payload.boltX ?? 0.5 },
      { name: "boltColor", value: hexToVec3(payload.color ?? "#e8f1ff") },
      { name: "opacity", value: Math.min(1, (payload.intensity ?? 0.75) * 1.2) },
    ])
    .locked(true)
    .disableHit(true)
    .layer("POST_PROCESS")
    .blendMode("SRC_OVER")
    .build();
  return addTemporaryEffect(effect, 190);
}

async function playStrike(payload) {
  const color = payload.color ?? "#e8f1ff";
  const intensity = Math.max(0.05, Math.min(1, payload.intensity ?? 0.75));

  if (payload.bolt !== false) void bolt(payload);

  await flash(color, intensity * 0.55, 55);
  if (payload.doubleFlash !== false) {
    await sleep(55 + Math.random() * 65);
    await flash(color, intensity * 0.85, 80);
  }
}

function randomDelayMs(settings) {
  const min = Math.max(1, Number(settings.minDelay) || 7);
  const max = Math.max(min, Number(settings.maxDelay) || 18);
  return (min + Math.random() * (max - min)) * 1000;
}

function stopStorm() {
  if (stormTimer) clearTimeout(stormTimer);
  stormTimer = null;
  stormSettings = null;
}

function scheduleNext() {
  if (role !== "GM" || !stormSettings) return;
  if (stormTimer) clearTimeout(stormTimer);
  stormTimer = setTimeout(async () => {
    if (!stormSettings) return;
    const payload = {
      ...stormSettings,
      seed: Math.random() * 10000,
      boltX: 0.18 + Math.random() * 0.64,
      issuedAt: Date.now(),
    };
    await OBR.broadcast.sendMessage(STRIKE_CHANNEL, payload, { destination: "ALL" });
    scheduleNext();
  }, randomDelayMs(stormSettings));
}

OBR.onReady(async () => {
  role = await OBR.player.getRole();

  OBR.broadcast.onMessage(STRIKE_CHANNEL, (event) => {
    void playStrike(event.data ?? {});
  });

  OBR.broadcast.onMessage(CONTROL_CHANNEL, (event) => {
    const message = event.data ?? {};
    if (message.type === "STOP") {
      stopStorm();
      return;
    }
    if (message.type === "START" && role === "GM") {
      stormSettings = message.settings ?? {};
      scheduleNext();
    }
  });
});
