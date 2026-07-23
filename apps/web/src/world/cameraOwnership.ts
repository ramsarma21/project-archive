// Pure camera-ownership resolver. Today Player.cameraOverride couples TWO
// distinct concerns — "skip the player's follow-camera write" and "freeze player
// movement" — into one boolean. Per Production Plan D.0.4 / Build-Brief M0 task
// 4 the chase needs an EXTERNAL camera WITH live movement, so those concerns
// must split. This module resolves, from the set of active camera claims, which
// owner holds the camera and the two independent policy outputs plus the
// movement-yaw basis. It is a pure function of its inputs: no React, no THREE,
// no wall clock — so precedence and transitions are unit-testable.
//
// Precedence (highest first): FIRST_PERSON, CHOREOGRAPHY, CHASE, PLAYER.
//   FIRST_PERSON / CHOREOGRAPHY : camera external AND movement locked (a staged
//       beat owns everything — preserves today's cameraOverride behavior).
//   CHASE                        : camera external, movement LIVE, WASD basis =
//       the external chase-camera yaw (the new capability).
//   PLAYER (implicit fallback)   : free roam; player owns its follow camera and
//       its own heading drives both movement and camera.

export type CameraOwner = "FIRST_PERSON" | "CHOREOGRAPHY" | "CHASE" | "PLAYER";

// How the player's directional input (WASD) should be interpreted this frame.
//   PLAYER : free roam — movement basis is the player's own camera/heading.
//   CAMERA : an external camera controls framing but movement stays live; WASD
//            is interpreted relative to `yaw` (the external chase-camera yaw).
//   LOCKED : movement is frozen (a staged beat); input basis is irrelevant.
export type MovementYawPolicy =
  | { mode: "PLAYER" }
  | { mode: "CAMERA"; yaw: number }
  | { mode: "LOCKED" };

export interface CameraClaims {
  firstPerson: boolean;
  choreography: boolean;
  chase: boolean;
  // The chase camera's current yaw (radians). Required to give CHASE a movement
  // basis; ignored unless CHASE wins. Defaults to 0 if omitted while chasing.
  chaseCameraYaw?: number | null;
}

export interface CameraOwnershipState {
  owner: CameraOwner;
  // Skip the player's own follow-camera write this frame (an external owner is
  // driving the camera transform).
  cameraControlledExternally: boolean;
  // Freeze player movement this frame.
  inputLocked: boolean;
  externalMovementYaw: MovementYawPolicy;
}

export function resolveCameraOwnership(
  claims: CameraClaims,
): CameraOwnershipState {
  // FIRST_PERSON is a more specific staged mode than CHOREOGRAPHY but resolves
  // to the same policy; it wins the owner label for clarity/telemetry.
  if (claims.firstPerson) {
    return {
      owner: "FIRST_PERSON",
      cameraControlledExternally: true,
      inputLocked: true,
      externalMovementYaw: { mode: "LOCKED" },
    };
  }
  if (claims.choreography) {
    return {
      owner: "CHOREOGRAPHY",
      cameraControlledExternally: true,
      inputLocked: true,
      externalMovementYaw: { mode: "LOCKED" },
    };
  }
  if (claims.chase) {
    return {
      owner: "CHASE",
      cameraControlledExternally: true,
      inputLocked: false, // the whole point of the split: live movement in chase
      externalMovementYaw: { mode: "CAMERA", yaw: claims.chaseCameraYaw ?? 0 },
    };
  }
  return {
    owner: "PLAYER",
    cameraControlledExternally: false,
    inputLocked: false,
    externalMovementYaw: { mode: "PLAYER" },
  };
}

export function movementYawForPolicy(
  policy: MovementYawPolicy,
  playerCameraYaw: number,
): number | null {
  if (policy.mode === "LOCKED") return null;
  return policy.mode === "CAMERA" ? policy.yaw : playerCameraYaw;
}

export interface CameraTransition {
  ownerChanged: boolean;
  from: CameraOwner;
  to: CameraOwner;
  // Entering external camera control must drop any in-progress player pointer
  // orbit/drag so a held mouse-drag doesn't leak into the staged/chase camera.
  cancelPointerDrag: boolean;
  // Returning to free roam should re-snap the follow camera behind the player
  // rather than jump-cutting from wherever the external owner left it.
  resetFollowCamera: boolean;
}

// Pure transition signal between two resolved states. Player/World3D consume the
// booleans imperatively; no state is held here.
export function cameraTransition(
  prev: CameraOwnershipState,
  next: CameraOwnershipState,
): CameraTransition {
  const ownerChanged = prev.owner !== next.owner;
  return {
    ownerChanged,
    from: prev.owner,
    to: next.owner,
    cancelPointerDrag:
      ownerChanged &&
      next.cameraControlledExternally &&
      !prev.cameraControlledExternally,
    resetFollowCamera: ownerChanged && next.owner === "PLAYER",
  };
}
