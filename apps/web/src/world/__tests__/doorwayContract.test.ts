import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUILDING_GLB_RAW_SIZE,
  DOOR_OPEN_ANGLE,
  buildingFacade,
  doorCollisionShapes,
  doorAwareBuildingColliders,
  doorwayForTarget,
  fittedSize,
  interiorDoorVisualAnchor,
  resolveDoorway,
  resolveInteriorDoorway,
  resolveAllExteriorDoorways,
  thresholdAnchorForLocation,
  buildExploreDoorwayProfiles,
  type DoorwayProfile,
  type Vec3,
} from "../doorwayContract.js";
import { BUILDINGS, EXPLORE_LOCATIONS } from "../manifest.js";

function near(a: number, b: number, tol: number, msg?: string) {
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} expected ${a} ≈ ${b} (±${tol})`);
}
function dist2d(a: Vec3, b: Vec3) {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

// ---- fitted-footprint math matches the confirmed root-cause examples --------
test("fitted footprint matches the diagnosis (uniform min-axis contain fit)", () => {
  // rowN1: bldg-row-clapboard-a target [7,8,8] renders ~[4.31,8,5.03]
  const rowN1 = fittedSize(BUILDING_GLB_RAW_SIZE["bldg-row-clapboard-a"]!, [7, 8, 8]);
  near(rowN1[0], 4.31, 0.02, "rowN1 width");
  near(rowN1[1], 8, 0.02, "rowN1 height");
  near(rowN1[2], 5.03, 0.02, "rowN1 depth");

  // church [13,15,12] renders ~[5.37,15,8.61]
  const church = fittedSize(BUILDING_GLB_RAW_SIZE["church-meetinghouse"]!, [13, 15, 12]);
  near(church[0], 5.37, 0.03, "church width");
  near(church[2], 8.61, 0.03, "church depth");

  // warehouseN2 [13,8,9] renders ~[4.51,8,4.54]
  const wh = fittedSize(BUILDING_GLB_RAW_SIZE["bldg-warehouse-wharf-b"]!, [13, 8, 9]);
  near(wh[0], 4.51, 0.02, "warehouseN2 width");
  near(wh[2], 4.54, 0.02, "warehouseN2 depth");
});

// ---- doors seat on the ACTUAL fitted facade, not the nominal slot -----------
test("explore door seats on the fitted facade (fixes 0.5-2.1m proud)", () => {
  const rowN1 = BUILDINGS.find((b) => b.id === "rowN1")!; // pos z=-15, north row
  const facade = buildingFacade(rowN1)!;
  // North row (rotY 0) faces +z; facade plane z = pos.z + fittedDepth/2.
  const expectedFacadeZ = rowN1.pos[2] + facade.actualHalfDepth;
  near(expectedFacadeZ, -15 + 5.024 / 2, 0.02, "fitted facade z");
  // The OLD nominal placement put the leaf at pos.z + size.z/2 = -11, i.e.
  // ~1.5m proud of the real facade. Confirm the delta the contract removes.
  const nominalZ = rowN1.pos[2] + rowN1.size[2] / 2;
  assert.ok(Math.abs(nominalZ - expectedFacadeZ) > 1.4, "nominal was proud by >1.4m");

  const profile = buildExploreDoorwayProfiles().find((p) => p.buildingId === "rowN1")!;
  const d = resolveDoorway(profile)!;
  // Facade point sits on the fitted plane, pulled in by the recess (6cm).
  near(d.facadePoint[2], expectedFacadeZ - 0.06, 0.005, "resolved facade z (recessed)");
  // Facade-depth accuracy well within the ≤3cm acceptance (recess excepted).
  near(Math.abs(d.facadePoint[2] - expectedFacadeZ), 0.06, 0.001, "recess only");
});

test("hinge sits clearWidth/2 from the leaf centre along the tangent", () => {
  const profile = buildExploreDoorwayProfiles().find((p) => p.buildingId === "rowN1")!;
  const d = resolveDoorway(profile)!;
  const along = dist2d(d.hinge, d.leafCenter);
  near(along, d.clearWidth / 2, 1e-6, "hinge offset");
  // Leaf centre sits a hair behind the facade point along -n.
  near(dist2d(d.leafCenter, d.facadePoint), d.thickness / 2 + 0.01, 1e-6, "leaf setback");
});

test("swing signs: exterior inward = -hingeSign, interior outward = +hingeSign", () => {
  const profile = buildExploreDoorwayProfiles().find((p) => p.buildingId === "rowN1")!;
  const d = resolveDoorway(profile)!;
  assert.equal(d.inwardOpenAngle, -d.hingeSign * DOOR_OPEN_ANGLE);
  assert.equal(d.outwardOpenAngle, d.hingeSign * DOOR_OPEN_ANGLE);
  assert.equal(Math.sign(d.inwardOpenAngle), -Math.sign(d.outwardOpenAngle));
});

test("sensors lie on the door tangent lane (no lateral pop > 5cm)", () => {
  const d = resolveDoorway(buildExploreDoorwayProfiles().find((p) => p.buildingId === "rowN1")!)!;
  const F: Vec3 = [d.facadePoint[0], 0, d.facadePoint[2]];
  // Each sensor is a pure ±n offset from F, so its tangential distance from the
  // F lane is ~0 (no lateral teleport).
  for (const s of [d.sensors.exterior, d.sensors.insideLanding, d.sensors.outsideExit]) {
    const rel: Vec3 = [s[0] - F[0], 0, s[2] - F[2]];
    const lateral = rel[0] * d.tangent[0] + rel[2] * d.tangent[2];
    assert.ok(Math.abs(lateral) < 0.05, `sensor lateral offset ${lateral}`);
  }
  // Exterior sensor is outward, inside landing is inward.
  const exDot =
    (d.sensors.exterior[0] - F[0]) * d.outwardNormal[0] +
    (d.sensors.exterior[2] - F[2]) * d.outwardNormal[2];
  assert.ok(exDot > 0, "exterior sensor is outward");
});

test("hero doorways resolve from their pinned facade overrides", () => {
  const all = resolveAllExteriorDoorways();
  for (const heroId of ["MERCER", "THOMAS", "PIKE", "CUSTOMS"]) {
    const d = all.find((r) => r.doorId === heroId);
    assert.ok(d, `${heroId} resolved`);
  }
  // Mercer keeps its audited facade x≈-0.31, z≈11.27 (minus recess along -n).
  const mercer = all.find((r) => r.doorId === "MERCER")!;
  near(mercer.facadePoint[0], -0.31, 0.02, "mercer x");
});

test("interior doorway shares the tangent lane and opens outward", () => {
  const loc = EXPLORE_LOCATIONS["EXPLORE_rowN1"]!;
  const room = loc.room!;
  const inner = resolveInteriorDoorway(loc.id, room);
  // North-side room: door wall at +z edge, outward normal toward +z (street).
  near(inner.outwardNormal[2], room.doorSide === "N" ? 1 : -1, 1e-9);
  assert.equal(inner.outwardOpenAngle, inner.hingeSign * DOOR_OPEN_ANGLE);
  near(dist2d(inner.hinge, inner.leafCenter), inner.clearWidth / 2, 1e-6);
});

test("every resolvable exterior doorway seats without a primitive fallback", () => {
  const resolved = resolveAllExteriorDoorways();
  // All hero + explore + rear profiles resolve (each has bounds or override).
  assert.ok(resolved.length >= 20, `resolved ${resolved.length} doorways`);
  for (const d of resolved) {
    assert.ok(Number.isFinite(d.facadePoint[0]) && Number.isFinite(d.facadePoint[2]));
    assert.ok(d.clearWidth > 0 && d.clearHeight > 0);
  }
});

test("collision shapes: dynamic closed leaf, hinge, imported-frame jambs, passage corridor", () => {
  const explore = resolveDoorway(buildExploreDoorwayProfiles().find((p) => p.buildingId === "rowN1")!)!;
  const shapes = doorCollisionShapes(explore);
  // Closed leaf is a finite dynamic OBB (never infinite-height): height == leaf.
  assert.ok(shapes.closedLeaf.tags.includes("dynamic"));
  near(shapes.closedLeaf.half[1] * 2, explore.clearHeight, 1e-6, "leaf height finite");
  // Imported-frame door contributes two static jamb solids around the opening.
  assert.equal(shapes.frame.length, 2);
  assert.ok(shapes.frame.every((f) => f.tags.includes("static")));
  // Open angle matches the inward exterior swing.
  assert.equal(shapes.openAngle, explore.inwardOpenAngle);
  // Passage corridor is a finite box on the tangent lane (not a global removal).
  assert.ok(shapes.passageCorridor.half[0] > 0 && shapes.passageCorridor.half[2] > 0);

  // A hero door seated in authored trim draws NO imported jambs.
  const pike = resolveAllExteriorDoorways().find((r) => r.doorId === "PIKE")!;
  assert.equal(doorCollisionShapes(pike).frame.length, 0);
});

test("semantic building collision blocks closed leaf and clears only its open target", () => {
  const mercer = doorwayForTarget("MERCER_PRESS")!;
  const closed = doorAwareBuildingColliders(null);
  const opened = doorAwareBuildingColliders("MERCER_PRESS");
  const isLeaf = (c: [number, number, number, number]) =>
    Math.abs(c[0] - mercer.leafCenter[0]) < 1e-6 &&
    Math.abs(c[1] - mercer.leafCenter[2]) < 1e-6 &&
    Math.abs(c[2] - mercer.clearWidth / 2) < 1e-6;
  assert.ok(closed.some(isLeaf), "closed semantic leaf blocks");
  assert.ok(!opened.some(isLeaf), "open semantic leaf clears");
  assert.ok(opened.length > BUILDINGS.length, "split walls and finite jambs remain");
});

test("interior and exterior threshold helpers preserve one tangent lane", () => {
  const loc = EXPLORE_LOCATIONS["EXPLORE_rowN1"]!;
  const inside = thresholdAnchorForLocation(loc, "INSIDE");
  const outside = thresholdAnchorForLocation(loc, "OUTSIDE");
  const visual = interiorDoorVisualAnchor(loc.id)!;
  near(inside[0], outside[0], 0.05, "no lateral threshold pop");
  assert.ok(Math.abs(visual[0] - inside[0]) > 0.3, "marker is beside jamb");
});

test("missing measured bounds yields null (renders nothing, no seat guess)", () => {
  const bogus: DoorwayProfile = {
    doorId: "BOGUS",
    buildingId: "___nonexistent___",
    targetIds: [],
    hingeSign: 1,
    trim: "imported-frame",
  };
  assert.equal(resolveDoorway(bogus), null);
});
