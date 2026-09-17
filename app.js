import OBR from "https://esm.run/@owlbear-rodeo/sdk@3.1.0";
import { CONTROL_CHANNEL, STRIKE_CHANNEL } from "./constants.js";

const $ = (id) => document.getElementById(id);

function settings() {
  let minDelay = Math.max(1, Number($("minDelay").value) || 7);
  let maxDelay = Math.max(1, Number($("maxDelay").value) || 18);
  if (minDelay > maxDelay) [minDelay, maxDelay] = [maxDelay, minDelay];
  return {
    color: $("color").value,
    intensity: Number($("intensity").value),
    minDelay,
    maxDelay,
    bolt: $("bolt").checked,
    doubleFlash: $("doubleFlash").checked,
  };
}

function makeStrikePayload() {
  const s = settings();
  return {
    ...s,
    seed: Math.random() * 10000,
    boltX: 0.18 + Math.random() * 0.64,
    issuedAt: Date.now(),
  };
}

function setStatus(text) {
  $("status").textContent = text;
}

OBR.onReady(async () => {
  const role = await OBR.player.getRole();
  const isGM = role === "GM";

  for (const id of ["strike", "start", "stop", "color", "intensity", "minDelay", "maxDelay", "bolt", "doubleFlash"]) {
    $(id).disabled = !isGM;
  }

  $("intensity").addEventListener("input", () => {
    $("intensityValue").textContent = Number($("intensity").value).toFixed(2);
  });

  if (!isGM) {
    setStatus("Эффект активен у игроков, но управляет им мастер.");
    return;
  }

  setStatus("Готово.");

  $("strike").addEventListener("click", async () => {
    await OBR.broadcast.sendMessage(STRIKE_CHANNEL, makeStrikePayload(), { destination: "ALL" });
    setStatus("Молния отправлена всем игрокам.");
  });

  $("start").addEventListener("click", async () => {
    const s = settings();
    await OBR.broadcast.sendMessage(CONTROL_CHANNEL, { type: "START", settings: s }, { destination: "ALL" });
    setStatus(`Автогроза: случайная молния каждые ${s.minDelay}–${s.maxDelay} сек.`);
  });

  $("stop").addEventListener("click", async () => {
    await OBR.broadcast.sendMessage(CONTROL_CHANNEL, { type: "STOP" }, { destination: "ALL" });
    setStatus("Автогроза остановлена.");
  });
});
