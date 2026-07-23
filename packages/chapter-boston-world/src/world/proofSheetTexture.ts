import * as THREE from "three";

export type ProofSheetVariant = "PLAIN" | "STAMPED";
const proofSheetTextures = new Map<ProofSheetVariant, THREE.CanvasTexture>();

export function getProofSheetTexture(variant: ProofSheetVariant = "PLAIN"): THREE.CanvasTexture {
  const cached = proofSheetTextures.get(variant);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 1024;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#eadcb8";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#a28d64";
  context.lineWidth = 8;
  context.strokeRect(26, 26, canvas.width - 52, canvas.height - 52);
  context.fillStyle = "#2d261c";
  context.textAlign = "center";
  context.font = "700 48px Georgia";
  context.fillText("MERCER'S PRESS", canvas.width / 2, 112);
  context.font = "600 28px Georgia";
  context.fillText("PROOF FOR MR. PIKE", canvas.width / 2, 166);
  context.font = "24px Georgia";
  context.fillText("Boston · 14 August 1765", canvas.width / 2, 210);
  context.textAlign = "left";
  context.font = "27px Georgia";
  [
    "NOTICE is hereby given that printed",
    "and legal papers named by Parliament",
    "must bear the required paid stamp",
    "from the First of November next.",
    "",
    "Set and printed at Mercer's Press.",
  ].forEach((line, index) => context.fillText(line, 70, 310 + index * 58));
  context.strokeStyle = "#514634";
  context.lineWidth = 3;
  for (let y = 700; y <= 870; y += 42) {
    context.beginPath();
    context.moveTo(72, y);
    context.lineTo(canvas.width - 72, y);
    context.stroke();
  }
  if (variant === "STAMPED") {
    context.save();
    context.translate(622, 602);
    context.rotate(-0.12);
    context.globalAlpha = 0.9;
    context.strokeStyle = "#8f2929";
    context.fillStyle = "#8f2929";
    context.lineWidth = 7;
    context.beginPath();
    context.arc(0, 0, 58, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(-28, -20);
    context.lineTo(-17, -38);
    context.lineTo(0, -22);
    context.lineTo(17, -38);
    context.lineTo(28, -20);
    context.closePath();
    context.stroke();
    context.textAlign = "center";
    context.font = "700 25px Georgia";
    context.fillText("PAID", 0, 8);
    context.font = "700 17px Georgia";
    context.fillText("STAMP", 0, 31);
    context.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  proofSheetTextures.set(variant, texture);
  return texture;
}
