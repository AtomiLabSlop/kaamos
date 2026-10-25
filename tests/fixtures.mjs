import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Small, valid test assets, generated rather than committed.
 *
 * The importer is worth testing against real files — a hand-written OBJ, a
 * binary glTF with an indexed mesh and a material, and an RLE-encoded Radiance
 * map — so that the loaders, not stand-ins, are what the smoke test exercises.
 */

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function writeFixtures() {
  mkdirSync(DIR, { recursive: true });
  writeObj();
  writeGlb();
  writeHdr();
  writeStep();
  return DIR;
}

/* ---------- OBJ: two named groups ---------- */
function writeObj() {
  writeFileSync(
    join(DIR, 'pyramid.obj'),
    `# smoke-test fixture
o Base
v -1 0 -1
v  1 0 -1
v  1 0  1
v -1 0  1
f 1 2 3
f 1 3 4
o Spire
v -0.5 0 -0.5
v  0.5 0 -0.5
v  0.0 1.4 0.0
v  0.5 0  0.5
v -0.5 0  0.5
f 5 6 7
f 6 8 7
f 8 9 7
f 9 5 7
`,
  );
}

/* ---------- GLB: an indexed box under a named node ---------- */
function writeGlb() {
  const positions = new Float32Array([
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,
    -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5,
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
    0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5,
    -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11,
    12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
  ]);

  const pad4 = (n) => (n + 3) & ~3;
  const posBytes = Buffer.from(positions.buffer);
  const idxOffset = pad4(posBytes.length);
  const idxBytes = Buffer.from(indices.buffer);
  const binLength = pad4(idxOffset + idxBytes.length);
  const bin = Buffer.alloc(binLength);
  posBytes.copy(bin, 0);
  idxBytes.copy(bin, idxOffset);

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a += 1) {
      min[a] = Math.min(min[a], positions[i + a]);
      max[a] = Math.max(max[a], positions[i + a]);
    }
  }

  const gltf = {
    asset: { version: '2.0', generator: 'kaamos smoke test' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'TestBox', mesh: 0, translation: [0, 0.5, 0] }],
    meshes: [
      {
        name: 'TestBoxMesh',
        primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }],
      },
    ],
    materials: [
      {
        name: 'TestRed',
        pbrMetallicRoughness: {
          baseColorFactor: [0.8, 0.2, 0.2, 1],
          metallicFactor: 0.1,
          roughnessFactor: 0.4,
        },
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: positions.length / 3,
        type: 'VEC3',
        min,
        max,
      },
      { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: idxOffset, byteLength: idxBytes.length, target: 34963 },
    ],
    buffers: [{ byteLength: binLength }],
  };

  const jsonText = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPadded = Buffer.alloc(pad4(jsonText.length), 0x20);
  jsonText.copy(jsonPadded);

  const total = 12 + 8 + jsonPadded.length + 8 + bin.length;
  const glb = Buffer.alloc(total);
  let o = 0;
  glb.write('glTF', o);
  o += 4;
  glb.writeUInt32LE(2, o);
  o += 4;
  glb.writeUInt32LE(total, o);
  o += 4;
  glb.writeUInt32LE(jsonPadded.length, o);
  o += 4;
  glb.write('JSON', o);
  o += 4;
  jsonPadded.copy(glb, o);
  o += jsonPadded.length;
  glb.writeUInt32LE(bin.length, o);
  o += 4;
  glb.write('BIN\0', o);
  o += 4;
  bin.copy(glb, o);

  writeFileSync(join(DIR, 'box.glb'), glb);
}

/* ---------- HDR: RLE-encoded Radiance, plus a deliberately broken one ---------- */
function writeHdr() {
  const W = 32;
  const H = 16;
  const parts = [
    Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${H} +X ${W}\n`, 'ascii'),
  ];

  for (let y = 0; y < H; y += 1) {
    const t = y / (H - 1);
    const mantissa = Math.round(255 - t * 170);
    const components = [
      Math.min(255, Math.round(mantissa * (0.9 + t * 0.25))),
      mantissa,
      Math.min(255, Math.round(mantissa * (1.05 - t * 0.2))),
      y < H / 2 ? 132 : 128,
    ];
    const line = Buffer.alloc(4 + 4 * 2);
    line[0] = 2;
    line[1] = 2;
    line[2] = (W >> 8) & 0xff;
    line[3] = W & 0xff;
    // One run per component: a run byte of 128 + count, then the value.
    for (let c = 0; c < 4; c += 1) {
      line[4 + c * 2] = 128 + W;
      line[5 + c * 2] = components[c];
    }
    parts.push(line);
  }

  writeFileSync(join(DIR, 'studio.hdr'), Buffer.concat(parts));
  writeFileSync(join(DIR, 'broken.hdr'), Buffer.from('not a radiance file', 'ascii'));
}

/* ---------- STEP: one closed solid, as a CAD system would write it ---------- */
function writeStep() {
  writeFileSync(join(DIR, 'block.step'), STEP_BLOCK);
}

/**
 * A minimal but genuinely valid AP214 B-rep: a 40 x 16 x 24 mm block.
 * Generated once and inlined rather than built at run time, because the point
 * of the fixture is to be a fixed, known-good file for the CAD importer.
 */
const STEP_BLOCK = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Kaamos test fixture'),'2;1');
FILE_NAME('block.step','2026-10-11T00:00:00',('test'),('test'),
  'handwritten','handwritten','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
#1 = APPLICATION_CONTEXT('automotive design');
#2 = APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#1);
#3 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );
#4 = ( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) );
#5 = ( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() );
#6 = UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#3,'distance_accuracy_value','confusion accuracy');
#7 = ( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#6)) GLOBAL_UNIT_ASSIGNED_CONTEXT((#3,#4,#5)) REPRESENTATION_CONTEXT('Context','3D') );
#8 = CARTESIAN_POINT('',(0.000000,0.000000,0.000000));
#9 = CARTESIAN_POINT('',(0.000000,0.000000,24.000000));
#10 = CARTESIAN_POINT('',(0.000000,16.000000,0.000000));
#11 = CARTESIAN_POINT('',(0.000000,16.000000,24.000000));
#12 = CARTESIAN_POINT('',(40.000000,0.000000,0.000000));
#13 = CARTESIAN_POINT('',(40.000000,0.000000,24.000000));
#14 = CARTESIAN_POINT('',(40.000000,16.000000,0.000000));
#15 = CARTESIAN_POINT('',(40.000000,16.000000,24.000000));
#16 = VERTEX_POINT('',#8);
#17 = VERTEX_POINT('',#9);
#18 = VERTEX_POINT('',#10);
#19 = VERTEX_POINT('',#11);
#20 = VERTEX_POINT('',#12);
#21 = VERTEX_POINT('',#13);
#22 = VERTEX_POINT('',#14);
#23 = VERTEX_POINT('',#15);
#24 = CARTESIAN_POINT('',(0.000000,0.000000,0.000000));
#25 = DIRECTION('',(1.000000,0.000000,0.000000));
#26 = VECTOR('',#25,1.0);
#27 = LINE('',#24,#26);
#28 = EDGE_CURVE('',#16,#20,#27,.T.);
#29 = ORIENTED_EDGE('',*,*,#28,.T.);
#30 = CARTESIAN_POINT('',(40.000000,0.000000,0.000000));
#31 = DIRECTION('',(0.000000,0.000000,1.000000));
#32 = VECTOR('',#31,1.0);
#33 = LINE('',#30,#32);
#34 = EDGE_CURVE('',#20,#21,#33,.T.);
#35 = ORIENTED_EDGE('',*,*,#34,.T.);
#36 = CARTESIAN_POINT('',(40.000000,0.000000,24.000000));
#37 = DIRECTION('',(-1.000000,0.000000,0.000000));
#38 = VECTOR('',#37,1.0);
#39 = LINE('',#36,#38);
#40 = EDGE_CURVE('',#21,#17,#39,.T.);
#41 = ORIENTED_EDGE('',*,*,#40,.T.);
#42 = CARTESIAN_POINT('',(0.000000,0.000000,24.000000));
#43 = DIRECTION('',(0.000000,0.000000,-1.000000));
#44 = VECTOR('',#43,1.0);
#45 = LINE('',#42,#44);
#46 = EDGE_CURVE('',#17,#16,#45,.T.);
#47 = ORIENTED_EDGE('',*,*,#46,.T.);
#48 = EDGE_LOOP('',(#29,#35,#41,#47));
#49 = FACE_OUTER_BOUND('',#48,.T.);
#50 = CARTESIAN_POINT('',(0.000000,0.000000,0.000000));
#51 = DIRECTION('',(0.000000,-1.000000,0.000000));
#52 = DIRECTION('',(1.000000,0.000000,0.000000));
#53 = AXIS2_PLACEMENT_3D('',#50,#51,#52);
#54 = PLANE('',#53);
#55 = ADVANCED_FACE('',(#49),#54,.T.);
#56 = CARTESIAN_POINT('',(0.000000,16.000000,0.000000));
#57 = DIRECTION('',(0.000000,0.000000,1.000000));
#58 = VECTOR('',#57,1.0);
#59 = LINE('',#56,#58);
#60 = EDGE_CURVE('',#18,#19,#59,.T.);
#61 = ORIENTED_EDGE('',*,*,#60,.T.);
#62 = CARTESIAN_POINT('',(0.000000,16.000000,24.000000));
#63 = DIRECTION('',(1.000000,0.000000,0.000000));
#64 = VECTOR('',#63,1.0);
#65 = LINE('',#62,#64);
#66 = EDGE_CURVE('',#19,#23,#65,.T.);
#67 = ORIENTED_EDGE('',*,*,#66,.T.);
#68 = CARTESIAN_POINT('',(40.000000,16.000000,24.000000));
#69 = DIRECTION('',(0.000000,0.000000,-1.000000));
#70 = VECTOR('',#69,1.0);
#71 = LINE('',#68,#70);
#72 = EDGE_CURVE('',#23,#22,#71,.T.);
#73 = ORIENTED_EDGE('',*,*,#72,.T.);
#74 = CARTESIAN_POINT('',(40.000000,16.000000,0.000000));
#75 = DIRECTION('',(-1.000000,0.000000,0.000000));
#76 = VECTOR('',#75,1.0);
#77 = LINE('',#74,#76);
#78 = EDGE_CURVE('',#22,#18,#77,.T.);
#79 = ORIENTED_EDGE('',*,*,#78,.T.);
#80 = EDGE_LOOP('',(#61,#67,#73,#79));
#81 = FACE_OUTER_BOUND('',#80,.T.);
#82 = CARTESIAN_POINT('',(0.000000,16.000000,0.000000));
#83 = DIRECTION('',(0.000000,1.000000,0.000000));
#84 = DIRECTION('',(1.000000,0.000000,0.000000));
#85 = AXIS2_PLACEMENT_3D('',#82,#83,#84);
#86 = PLANE('',#85);
#87 = ADVANCED_FACE('',(#81),#86,.T.);
#88 = ORIENTED_EDGE('',*,*,#40,.F.);
#89 = CARTESIAN_POINT('',(40.000000,0.000000,24.000000));
#90 = DIRECTION('',(0.000000,1.000000,0.000000));
#91 = VECTOR('',#90,1.0);
#92 = LINE('',#89,#91);
#93 = EDGE_CURVE('',#21,#23,#92,.T.);
#94 = ORIENTED_EDGE('',*,*,#93,.T.);
#95 = ORIENTED_EDGE('',*,*,#66,.F.);
#96 = CARTESIAN_POINT('',(0.000000,16.000000,24.000000));
#97 = DIRECTION('',(0.000000,-1.000000,0.000000));
#98 = VECTOR('',#97,1.0);
#99 = LINE('',#96,#98);
#100 = EDGE_CURVE('',#19,#17,#99,.T.);
#101 = ORIENTED_EDGE('',*,*,#100,.T.);
#102 = EDGE_LOOP('',(#88,#94,#95,#101));
#103 = FACE_OUTER_BOUND('',#102,.T.);
#104 = CARTESIAN_POINT('',(0.000000,0.000000,24.000000));
#105 = DIRECTION('',(0.000000,0.000000,1.000000));
#106 = DIRECTION('',(1.000000,0.000000,0.000000));
#107 = AXIS2_PLACEMENT_3D('',#104,#105,#106);
#108 = PLANE('',#107);
#109 = ADVANCED_FACE('',(#103),#108,.T.);
#110 = CARTESIAN_POINT('',(0.000000,0.000000,0.000000));
#111 = DIRECTION('',(0.000000,1.000000,0.000000));
#112 = VECTOR('',#111,1.0);
#113 = LINE('',#110,#112);
#114 = EDGE_CURVE('',#16,#18,#113,.T.);
#115 = ORIENTED_EDGE('',*,*,#114,.T.);
#116 = ORIENTED_EDGE('',*,*,#78,.F.);
#117 = CARTESIAN_POINT('',(40.000000,16.000000,0.000000));
#118 = DIRECTION('',(0.000000,-1.000000,0.000000));
#119 = VECTOR('',#118,1.0);
#120 = LINE('',#117,#119);
#121 = EDGE_CURVE('',#22,#20,#120,.T.);
#122 = ORIENTED_EDGE('',*,*,#121,.T.);
#123 = ORIENTED_EDGE('',*,*,#28,.F.);
#124 = EDGE_LOOP('',(#115,#116,#122,#123));
#125 = FACE_OUTER_BOUND('',#124,.T.);
#126 = CARTESIAN_POINT('',(0.000000,0.000000,0.000000));
#127 = DIRECTION('',(0.000000,0.000000,-1.000000));
#128 = DIRECTION('',(1.000000,0.000000,0.000000));
#129 = AXIS2_PLACEMENT_3D('',#126,#127,#128);
#130 = PLANE('',#129);
#131 = ADVANCED_FACE('',(#125),#130,.T.);
#132 = ORIENTED_EDGE('',*,*,#46,.F.);
#133 = ORIENTED_EDGE('',*,*,#100,.F.);
#134 = ORIENTED_EDGE('',*,*,#60,.F.);
#135 = ORIENTED_EDGE('',*,*,#114,.F.);
#136 = EDGE_LOOP('',(#132,#133,#134,#135));
#137 = FACE_OUTER_BOUND('',#136,.T.);
#138 = CARTESIAN_POINT('',(0.000000,0.000000,0.000000));
#139 = DIRECTION('',(-1.000000,0.000000,0.000000));
#140 = DIRECTION('',(0.000000,0.000000,1.000000));
#141 = AXIS2_PLACEMENT_3D('',#138,#139,#140);
#142 = PLANE('',#141);
#143 = ADVANCED_FACE('',(#137),#142,.T.);
#144 = ORIENTED_EDGE('',*,*,#121,.F.);
#145 = ORIENTED_EDGE('',*,*,#72,.F.);
#146 = ORIENTED_EDGE('',*,*,#93,.F.);
#147 = ORIENTED_EDGE('',*,*,#34,.F.);
#148 = EDGE_LOOP('',(#144,#145,#146,#147));
#149 = FACE_OUTER_BOUND('',#148,.T.);
#150 = CARTESIAN_POINT('',(40.000000,0.000000,0.000000));
#151 = DIRECTION('',(1.000000,0.000000,0.000000));
#152 = DIRECTION('',(0.000000,0.000000,1.000000));
#153 = AXIS2_PLACEMENT_3D('',#150,#151,#152);
#154 = PLANE('',#153);
#155 = ADVANCED_FACE('',(#149),#154,.T.);
#156 = CLOSED_SHELL('',(#55,#87,#109,#131,#143,#155));
#157 = MANIFOLD_SOLID_BREP('TestBlock',#156);
#158 = CARTESIAN_POINT('',(0.,0.,0.));
#159 = DIRECTION('',(0.000000,0.000000,1.000000));
#160 = DIRECTION('',(1.000000,0.000000,0.000000));
#161 = AXIS2_PLACEMENT_3D('',#158,#159,#160);
#162 = ADVANCED_BREP_SHAPE_REPRESENTATION('TestBlock',(#161,#157),#7);
#163 = PRODUCT_CONTEXT('',#1,'mechanical');
#164 = PRODUCT('TestBlock','TestBlock','',(#163));
#165 = PRODUCT_DEFINITION_FORMATION('','',#164);
#166 = PRODUCT_DEFINITION_CONTEXT('part definition',#1,'design');
#167 = PRODUCT_DEFINITION('design','',#165,#166);
#168 = PRODUCT_DEFINITION_SHAPE('','',#167);
#169 = SHAPE_DEFINITION_REPRESENTATION(#168,#162);
ENDSEC;
END-ISO-10303-21;
`;
