// Runtime retarget of the Mixamo animation library onto Meshy-rigged
// characters. Both are humanoid; we remap bone names and rebase each
// rotation keyframe by the rest-pose delta:
//   qTarget(t) = qTargetRest * inverse(qSourceRest) * qSource(t)
// Hips position keys are rebased and scaled by the hips rest-height ratio.
import * as THREE from "three";

// three.js GLTFLoader sanitizes node names: "mixamorig:Hips" -> "mixamorigHips".
const MIXAMO_TO_MESHY: Record<string, string> = {
  mixamorigHips: "Hips",
  mixamorigSpine: "Spine",
  mixamorigSpine1: "Spine01",
  mixamorigSpine2: "Spine02",
  mixamorigNeck: "neck",
  mixamorigHead: "Head",
  mixamorigLeftShoulder: "LeftShoulder",
  mixamorigLeftArm: "LeftArm",
  mixamorigLeftForeArm: "LeftForeArm",
  mixamorigLeftHand: "LeftHand",
  mixamorigRightShoulder: "RightShoulder",
  mixamorigRightArm: "RightArm",
  mixamorigRightForeArm: "RightForeArm",
  mixamorigRightHand: "RightHand",
  mixamorigLeftUpLeg: "LeftUpLeg",
  mixamorigLeftLeg: "LeftLeg",
  mixamorigLeftFoot: "LeftFoot",
  mixamorigLeftToeBase: "LeftToeBase",
  mixamorigRightUpLeg: "RightUpLeg",
  mixamorigRightLeg: "RightLeg",
  mixamorigRightFoot: "RightFoot",
  mixamorigRightToeBase: "RightToeBase",
};

export interface RestPose {
  quat: Map<string, THREE.Quaternion>;
  pos: Map<string, THREE.Vector3>;
  hipsY: number;
}

export function captureRestPose(root: THREE.Object3D, hipsName: string): RestPose {
  const quat = new Map<string, THREE.Quaternion>();
  const pos = new Map<string, THREE.Vector3>();
  let hipsY = 1;
  root.traverse((o) => {
    quat.set(o.name, o.quaternion.clone());
    pos.set(o.name, o.position.clone());
    if (o.name === hipsName) hipsY = Math.abs(o.position.y) || 1;
  });
  return { quat, pos, hipsY };
}

// Retarget one source clip onto a target skeleton described by its rest pose.
export function retargetClip(
  clip: THREE.AnimationClip,
  sourceRest: RestPose,
  targetRest: RestPose,
): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  const scale = targetRest.hipsY / sourceRest.hipsY;

  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf(".");
    const srcBone = track.name.slice(0, dot);
    const prop = track.name.slice(dot + 1);
    const dstBone = MIXAMO_TO_MESHY[srcBone];
    if (!dstBone) continue;

    if (prop === "quaternion" && track instanceof THREE.QuaternionKeyframeTrack) {
      const qSrcRest = sourceRest.quat.get(srcBone);
      const qDstRest = targetRest.quat.get(dstBone);
      if (!qSrcRest || !qDstRest) continue;
      const inv = qSrcRest.clone().invert();
      const values = new Float32Array(track.values.length);
      const q = new THREE.Quaternion();
      for (let i = 0; i < track.values.length; i += 4) {
        q.fromArray(track.values, i);
        // delta in the source bone's local frame, replayed from the target rest
        q.copy(qDstRest.clone().multiply(inv.clone().multiply(q)));
        q.toArray(values, i);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${dstBone}.quaternion`, Array.from(track.times), Array.from(values)));
    } else if (prop === "position" && dstBone === "Hips") {
      const pSrcRest = sourceRest.pos.get(srcBone);
      const pDstRest = targetRest.pos.get(dstBone);
      if (!pSrcRest || !pDstRest) continue;
      const values = new Float32Array(track.values.length);
      for (let i = 0; i < track.values.length; i += 3) {
        values[i] = pDstRest.x + (track.values[i]! - pSrcRest.x) * scale;
        values[i + 1] = pDstRest.y + (track.values[i + 1]! - pSrcRest.y) * scale;
        values[i + 2] = pDstRest.z + (track.values[i + 2]! - pSrcRest.z) * scale;
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${dstBone}.position`, Array.from(track.times), Array.from(values)));
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

// Library cache: source rest pose + raw clips, computed once per session.
let libCache: { rest: RestPose; clips: THREE.AnimationClip[] } | null = null;

export function prepareLibrary(scene: THREE.Object3D, clips: THREE.AnimationClip[]) {
  if (!libCache) {
    libCache = { rest: captureRestPose(scene, "mixamorigHips"), clips };
  }
  return libCache;
}

const perTargetCache = new Map<string, Map<string, THREE.AnimationClip>>();

export function clipFor(targetKey: string, targetRest: RestPose, clipName: string): THREE.AnimationClip | null {
  if (!libCache) return null;
  let bucket = perTargetCache.get(targetKey);
  if (!bucket) {
    bucket = new Map();
    perTargetCache.set(targetKey, bucket);
  }
  const hit = bucket.get(clipName);
  if (hit) return hit;
  const src = libCache.clips.find((c) => c.name === clipName);
  if (!src) return null;
  const out = retargetClip(src, libCache.rest, targetRest);
  bucket.set(clipName, out);
  return out;
}
