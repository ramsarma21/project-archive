import { platformFromRect } from "../packages/engine-world/src/collision.ts";
import { encounterById } from "../packages/mission-m1/src/encounters/bank.ts";
import { selectEncounterVariant } from "../packages/mission-m1/src/encounters/select.ts";
import { createEncounterInstance, stepEncounter } from "../packages/mission-m1/src/encounters/machine.ts";
import { FIELD_TICK_HZ } from "../packages/engine-world/src/fieldSimulation.ts";
const DT = 1/FIELD_TICK_HZ;
const world = { blockers: [], platforms: [platformFromRect("PLAYER_PAD",16.0,17.2,-0.2,1.0,0), platformFromRect("SPEAKER_PAD",28.0,32.0,-1.0,2.0,0)], bounds:{minX:10,maxX:40,minZ:-12,maxZ:40} };
const enc = encounterById("SHAMBLES_STOP");
const inst = createEncounterInstance(enc, selectEncounterVariant(enc,"0123456789abcdef0123456789abcdef",1));
const player = {x:16.6,y:0,z:0.4};
const poses=[{id:"WATCH_SHAMBLES",pos:{x:30,y:0,z:0.4},yaw:Math.PI},{id:"SENTRY_GAOL",pos:{x:30.5,y:0,z:0.9},yaw:Math.PI}];
const step=(t)=>stepEncounter(inst,{world,tick:t,player:{pos:player,grounded:true},actorPoses:poses,dt:DT,submit:false,verdict:null,dismiss:false});
step(0);
const spk=()=>inst.actors.find(a=>a.kind==="SPEAKER");
console.log("armed",inst.phase,"speaker start",JSON.stringify(spk().pos),"goal",JSON.stringify(spk().goal));
for(let t=1;t<1100;t++){const r=step(t); if(t%120===0||r.phase!=="APPROACH"){const s=spk();const d=s?Math.hypot(s.pos.x-player.x,s.pos.z-player.z):NaN;console.log(`t=${t} phase=${r.phase} spk=${s?JSON.stringify({x:+s.pos.x.toFixed(2),z:+s.pos.z.toFixed(2)}):"-"} dXZ=${d.toFixed(2)}`);} if(r.phase!=="APPROACH")break;}
