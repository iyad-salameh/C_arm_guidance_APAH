import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { projectPointToLineParamsInto } from './utils/imagingGeometry.js';
import ControllerPanel from './components/ControllerPanel';

const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;

// --- CONFIGURATION ---
const PATIENT_URL = 'https://raw.githubusercontent.com/iyad-salameh/C_arm_guidance_APAH/main/assets/patient.glb?v=3';
const CARM_URL = 'https://raw.githubusercontent.com/iyad-salameh/C_arm_guidance_APAH/main/assets/c-armModel.glb?v=1';
const realsense_URL = 'https://raw.githubusercontent.com/iyad-salameh/C_arm_guidance_APAH/main/assets/realsense.glb?v=1';
const ISO_WORLD = new THREE.Vector3(0, 1.45, 0);

const DEVICE_PROFILE = {
    limits: {
        // Translations (meters)
        lift: { min: -0.5, max: 0.05 },
        cart_x: { min: 0.8, max: 2.5 },
        cart_z: { min: -1.5, max: 1.5 },
        // Rotations (degrees) - will be converted to radians for control limits
        orbital: { min: -100, max: 100 },
        wig_wag: { min: -23, max: 23 },    // approx +/- 0.4 rad
        column_rot: { min: -86, max: 86 }, // approx +/- 1.5 rad
    }
};

const CONTROL_SPECS = {
    cart_x: {
        label: 'Cart Long',
        type: 'translate',
        ...DEVICE_PROFILE.limits.cart_x,
        step: 0.01
    },
    cart_z: {
        label: 'Cart Lat',
        type: 'translate',
        ...DEVICE_PROFILE.limits.cart_z,
        step: 0.01
    },
    lift: {
        label: 'Lift',
        type: 'translate',
        ...DEVICE_PROFILE.limits.lift,
        step: 0.001
    },
    orbital_slide: {
        label: 'Orbital',
        type: 'rotate',
        min: DEVICE_PROFILE.limits.orbital.min * D2R,
        max: DEVICE_PROFILE.limits.orbital.max * D2R,
        step: 0.1 * D2R
    },
    wig_wag: {
        label: 'Wig Wag',
        type: 'rotate',
        min: DEVICE_PROFILE.limits.wig_wag.min * D2R,
        max: DEVICE_PROFILE.limits.wig_wag.max * D2R,
        step: 0.1 * D2R
    },
    column_rot: {
        label: 'Column Rot',
        type: 'rotate',
        min: DEVICE_PROFILE.limits.column_rot.min * D2R,
        max: DEVICE_PROFILE.limits.column_rot.max * D2R,
        step: 0.5 * D2R
    },
};

// --- ANATOMY ZONE HELPER (single source of truth) ---
const ZONE_DEFS = {
    miss: { key: 'miss', label: 'MISS (OFF PATIENT)' },

    // Core axial skeleton
    head: { key: 'head', label: 'HEAD / NECK' },
    thorax: { key: 'thorax', label: 'CHEST / THORAX' },
    abdomen: { key: 'abdomen', label: 'ABDOMEN' },
    pelvis: { key: 'pelvis', label: 'PELVIS / HIP' },

    // Upper limb (both sides)
    shoulder: { key: 'shoulder', label: 'SHOULDER / CLAVICLE' },
    humerus: { key: 'humerus', label: 'HUMERUS / ELBOW' },
    forearm: { key: 'forearm', label: 'FOREARM / WRIST' },
    hand: { key: 'hand', label: 'HAND / FINGERS' },

    // Lower limb
    femur: { key: 'femur', label: 'FEMUR' },
    knee: { key: 'knee', label: 'KNEE' },
    tibia: { key: 'tibia', label: 'TIBIA / FIBULA' },
    ankle: { key: 'ankle', label: 'ANKLE' },
    foot: { key: 'foot', label: 'FOOT / TOES' },
};

// Axis Mapping Config (Swap if your GLB is rotated)
const ANATOMY_AXES = { up: 'y', leftRight: 'x', frontBack: 'z' };


// --- ROBUST ZONE CLASSIFIER HELPERS (SKELETON-BASED) ---

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// 1. AXIS INFERENCE & SKELETON DEFINITION
// ------------------------------------------------------------------

// Detect Long/Width/Thick axes from bounds dimensions
const getInferredPatientAxes = (bounds) => {
    const s = {
        x: bounds.maxX - bounds.minX,
        y: bounds.maxY - bounds.minY,
        z: bounds.maxZ - bounds.minZ
    };
    // Sort keys by size: Descending
    const axes = Object.keys(s).sort((a, b) => s[b] - s[a]);

    return {
        long: axes[0],   // Largest (Head-Feet)
        width: axes[1],  // Medium (Left-Right)
        thick: axes[2]   // Smallest (Front-Back)
    };
};

// 1.1 LANDMARK DEFINITION (Normalized 0..1 in Patient Box)
// Coord Order: (uLong, uWidth, uThick)
// uLong: 0=Feet, 1=Head
// uWidth: 0.5=Midline. <0.5 Right?, >0.5 Left? (Depends on patient sign, we infer width axis)
const LANDMARKS_NORM = {
    // Spine
    "lowerSpine": new THREE.Vector3(0.44, 0.50, 0.50),
    "midSpine": new THREE.Vector3(0.62, 0.50, 0.50),
    "upperSpine": new THREE.Vector3(0.76, 0.50, 0.50),
    "neck": new THREE.Vector3(0.86, 0.50, 0.50),
    "head": new THREE.Vector3(0.95, 0.50, 0.50),

    // Legs (Right)
    "rightHip": new THREE.Vector3(0.42, 0.55, 0.50),
    "rightKnee": new THREE.Vector3(0.22, 0.55, 0.50),
    "rightFoot": new THREE.Vector3(0.05, 0.55, 0.50),

    // Legs (Left)
    "leftHip": new THREE.Vector3(0.42, 0.45, 0.50),
    "leftKnee": new THREE.Vector3(0.22, 0.45, 0.50),
    "leftFoot": new THREE.Vector3(0.05, 0.45, 0.50),

    // Arms (Right)
    "rightShoulder": new THREE.Vector3(0.76, 0.65, 0.50),
    "rightElbow": new THREE.Vector3(0.60, 0.70, 0.50),
    "rightHand": new THREE.Vector3(0.46, 0.72, 0.50),

    // Arms (Left)
    "leftShoulder": new THREE.Vector3(0.76, 0.35, 0.50),
    "leftElbow": new THREE.Vector3(0.60, 0.30, 0.50),
    "leftHand": new THREE.Vector3(0.46, 0.28, 0.50)
};

// 1.2 EDGES (Bone Segments)
const EDGES = [
    ["head", "neck"],
    ["neck", "upperSpine"],
    ["upperSpine", "midSpine"],
    ["midSpine", "lowerSpine"],
    ["lowerSpine", "leftHip"],
    ["leftHip", "leftKnee"],
    ["leftKnee", "leftFoot"],
    ["lowerSpine", "rightHip"],
    ["rightHip", "rightKnee"],
    ["rightKnee", "rightFoot"],
    ["upperSpine", "leftShoulder"],
    ["leftShoulder", "leftElbow"],
    ["leftElbow", "leftHand"],
    ["upperSpine", "rightShoulder"],
    ["rightShoulder", "rightElbow"],
    ["rightElbow", "rightHand"]
];

// 1.3 CORRECTION OFFSETS (Meters)
// Applied laterally (along Width axis) OUTWARD from midline
const OFFSETS_LOCAL_M = {
    "rightHand": 0.20, "leftHand": 0.20,
    "rightKnee": 0.12, "leftKnee": 0.12,
    "rightFoot": 0.12, "leftFoot": 0.12,
    "leftElbow": 0.05, "rightElbow": 0.05 // Minor adjustment for elbows
};

// 2. HELPERS
// ------------------------------------------------------------------

// Helper: Compute Local Position for a Landmark (with Corrections)
const landmarkLocal = (name, bounds, axes) => {
    const norm = LANDMARKS_NORM[name];
    if (!norm) return new THREE.Vector3();

    // 1. Basic Norm -> Local
    const local = new THREE.Vector3();
    const setVal = (axis, uVal) => {
        const min = bounds['min' + axis.toUpperCase()];
        const max = bounds['max' + axis.toUpperCase()];
        local[axis] = min + uVal * (max - min);
    };
    setVal(axes.long, norm.x);
    setVal(axes.width, norm.y);
    setVal(axes.thick, norm.z);

    // 2. Apply Lateral Correction
    const offset = OFFSETS_LOCAL_M[name];
    if (offset) {
        const midMin = bounds['min' + axes.width.toUpperCase()];
        const midMax = bounds['max' + axes.width.toUpperCase()];
        const midVal = (midMin + midMax) / 2;

        // Determine Outward Direction
        // If current > mid, add offset. If current < mid, subtract offset.
        // This pushes "out" from center.
        const currentW = local[axes.width];
        const dir = (currentW >= midVal) ? 1.0 : -1.0;

        local[axes.width] += offset * dir;
    }

    return local;
};

// Helper: Map Edge to ZoneKey
const getZoneKeyForEdge = (startNode, endNode, t) => {
    const key = `${startNode}-${endNode}`;

    // Spine / Torso
    if (key.includes("head") || key.includes("neck")) return ZONE_DEFS.head;
    if (key.includes("upperSpine")) return ZONE_DEFS.thorax;
    if (key.includes("midSpine")) return ZONE_DEFS.abdomen;
    if (key.includes("lowerSpine") && (key.includes("Hip") || key.includes("mid"))) return ZONE_DEFS.pelvis;

    // Legs
    if (key.includes("Hip") && key.includes("Knee")) return ZONE_DEFS.femur;
    if (key.includes("Knee") && key.includes("Foot")) {
        // T-based split
        if (t < 0.2) return ZONE_DEFS.knee;
        if (t > 0.85) return ZONE_DEFS.foot;
        return ZONE_DEFS.tibia;
    }

    // Arms
    if (key.includes("Shoulder") && key.includes("Elbow")) return ZONE_DEFS.humerus;
    if (key.includes("Elbow") && key.includes("Hand")) {
        if (t > 0.7) return ZONE_DEFS.hand;
        return ZONE_DEFS.forearm;
    }
    if (key.includes("upperSpine") && key.includes("Shoulder")) return ZONE_DEFS.shoulder;

    return ZONE_DEFS.miss;
};

// Math: Point to Segment Distance
const distancePointToSegment = (P, A, B) => {
    const pax = P.x - A.x, pay = P.y - A.y, paz = P.z - A.z;
    const bax = B.x - A.x, bay = B.y - A.y, baz = B.z - A.z;
    const lenSq = bax * bax + bay * bay + baz * baz;
    const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (lenSq + 1e-8)));
    const dx = pax - bax * h;
    const dy = pay - bay * h;
    const dz = paz - baz * h;
    return { d2: dx * dx + dy * dy + dz * dz, t: h, h };
};

// 3. CLASSIFIER
const classifyLocalPointBySkeleton = (pLocal, localLandmarks) => {
    let bestD2 = Infinity;
    let bestZone = ZONE_DEFS.miss;
    let bestEdgeName = "";

    // Iterate Edges
    for (const [startName, endName] of EDGES) {
        const A = localLandmarks[startName];
        const B = localLandmarks[endName];

        if (!A || !B) continue;

        const { d2, t } = distancePointToSegment(pLocal, A, B);

        if (d2 < bestD2) {
            bestD2 = d2;
            const zone = getZoneKeyForEdge(startName, endName, t);
            bestZone = zone;
            bestEdgeName = `${startName}->${endName}`;
        }
    }

    return { zone: bestZone, d2: bestD2, edge: bestEdgeName };
};

// Legacy fallback for cart_x logic (mapped to new keys)
const getAnatomyZone = (cart_x) => {
    if (cart_x < 1.2) return ZONE_DEFS.head;
    if (cart_x < 1.7) return ZONE_DEFS.thorax;
    if (cart_x < 2.1) return ZONE_DEFS.abdomen;
    if (cart_x < 2.3) return ZONE_DEFS.femur;
    return ZONE_DEFS.tibia; // Proxy for legs
};


// --- MAIN APP ---
const App = () => {
    const mountRef = useRef(null);

    const [controls, setControls] = useState({
        lift: -0.178,
        column_rot: 0,
        wig_wag: 0,
        orbital_slide: 0,
        cart_x: 1.700, // Longitudinal
        cart_z: 0.600, // Lateral (New)
    });
    const [beamActive, setBeamActive] = useState(false);
    const [lastXray, setLastXray] = useState(null);
    const [currentAnatomy, setCurrentAnatomy] = useState("READY");
    const [modelLoading, setModelLoading] = useState(true);
    const [debugEnabled, setDebugEnabled] = useState(false);
    const [debugReadout, setDebugReadout] = useState(null);

    const debugEnabledRef = useRef(false);
    const lastDebugUpdateRef = useRef(0);
    const beamActiveRef = useRef(false);
    const controlsRef = useRef(controls);

    const beamRegionRef = useRef("WAITING FOR PATIENT..."); // Kept for label string
    const beamZoneKeyRef = useRef('miss'); // NEW: Store key
    const beamHitRef = useRef(false);
    const beamNormYRef = useRef(null);
    const [beamRegionUI, setBeamRegionUI] = useState("WAITING FOR PATIENT...");
    const [beamZoneKeyUI, setBeamZoneKeyUI] = useState('miss'); // For header color

    const patientModelRef = useRef(null);
    const patientBoundsRef = useRef({ ready: false, minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 });

    useEffect(() => { controlsRef.current = controls; }, [controls]);

    // Scene Graph Refs
    const cartRef = useRef(null);
    const columnRotRef = useRef(new THREE.Group());
    const liftRef = useRef(new THREE.Group());
    const wigWagRef = useRef(new THREE.Group());
    const cArmSlideRef = useRef(new THREE.Group());
    const beamRef = useRef(null);
    // const cArmModelRef = useRef(null); // Unused
    const srcAnchorRef = useRef(new THREE.Group());
    const detAnchorRef = useRef(new THREE.Group());
    const skeletonDebugRef = useRef(null); // Skeleton Debug Group

    // Depth Viewer Refs
    const realsenseModelRef = useRef(null);
    const depthCameraRef = useRef(null);
    const depthCameraHelperRef = useRef(null); // Helper for debugging
    const depthRenderTargetRef = useRef(null);
    const depthCanvasRef = useRef(null);
    const rendererRef = useRef(null);
    const depthVizSceneRef = useRef(null);
    const depthVizQuadRef = useRef(null);
    const depthVizTargetRef = useRef(null);

    // Camera Control State (Restored)
    const [controlTarget, setControlTarget] = useState('camera'); // 'camera' or 'realsense'

    // Camera State
    const [camOffset, setCamOffset] = useState({ x: 0.00, y: -0.06, z: 0.00 });
    const [camRot, setCamRot] = useState({ x: 89, y: 0, z: 180 });

    // RealSense State (Defaulted to current fixed values)
    const [rsOffset, setRsOffset] = useState({ x: 0.00, y: 0.67, z: 0.23 });
    const [rsRot, setRsRot] = useState({ x: 90, y: 0, z: 180 });

    // Refs for animation loop access
    const camOffsetRef = useRef(camOffset);
    const camRotRef = useRef(camRot);
    const rsOffsetRef = useRef(rsOffset);
    const rsRotRef = useRef(rsRot);

    useEffect(() => {
        camOffsetRef.current = camOffset;
        camRotRef.current = camRot;
        rsOffsetRef.current = rsOffset;
        rsRotRef.current = rsRot;
    }, [camOffset, camRot, rsOffset, rsRot]);

    // Debug Refs

    const showLandmarksRef = useRef(false);
    const hasRenderedInitialRef = useRef(false);


    // --- DYNAMIC ANATOMY GENERATOR ---
    const generateRealisticXray = (currentControls = controls, zoneKeyOverride = null) => {
        const { cart_x, orbital_slide, wig_wag } = currentControls;

        // 1. Determine Anatomy Zone
        let zone = ZONE_DEFS.miss; // Default

        if (zoneKeyOverride) {
            // New path: pass key directly
            zone = ZONE_DEFS[zoneKeyOverride] || ZONE_DEFS.miss;
        } else {
            // Fallback to cart_x if no override (maintenance compatibility)
            zone = getAnatomyZone(cart_x);
        }

        const anatomyType = zone.label;
        let svgContent = "";

        // Normalize rotation for view width (cos effect for rotation)
        const viewWidth = Math.abs(Math.cos(orbital_slide)) * 0.8 + 0.2;
        const spineOffset = Math.sin(orbital_slide) * 20; // Spine moves off-center during rotation

        // Common bone styles
        const boneFill = "#ddd";
        const boneOpacity = "0.85";
        const jointOpacity = "0.9";

        // -- GENERATION LOGIC (Skeleton-Aware) --
        switch (zone.key) {
            case 'miss':
                // NOISE ONLY - No SVG content
                svgContent = "";
                break;

            case 'head':
                // Skull & Cervical Spine
                svgContent = `
                <ellipse cx="${50 + spineOffset * 0.5}" cy="40" rx="${30 * viewWidth}" ry="35" fill="${boneFill}" opacity="0.9" filter="url(#blur)" />
                <path d="M ${50 + spineOffset * 0.5 - 20 * viewWidth} 50 Q ${50 + spineOffset * 0.5} 80 ${50 + spineOffset * 0.5 + 20 * viewWidth} 50" stroke="#aaa" stroke-width="3" fill="none" opacity="0.8" />
                <rect x="${45 + spineOffset}" y="70" width="10" height="15" rx="3" fill="#eee" opacity="0.9" />
                <rect x="${45 + spineOffset}" y="88" width="10" height="15" rx="3" fill="#eee" opacity="0.9" />
                `;
                break;

            case 'thorax':
            case 'chest': // Legacy key mapping just in case
                // Ribs & Thoracic Spine
                const scrollYThorax = (cart_x % 0.2) * 500;
                let ribs = "";
                for (let i = 0; i < 6; i++) {
                    const yBase = (i * 18) - scrollYThorax + 20;
                    if (yBase > -10 && yBase < 110) {
                        ribs += `
                        <path d="M ${50 + spineOffset} ${yBase} Q ${10} ${yBase + 10} ${15} ${yBase + 25}" stroke="#ccc" stroke-width="4" fill="none" opacity="0.5" filter="url(#blur)" />
                        <path d="M ${50 + spineOffset} ${yBase} Q ${90} ${yBase + 10} ${85} ${yBase + 25}" stroke="#ccc" stroke-width="4" fill="none" opacity="0.5" filter="url(#blur)" />
                        `;
                    }
                }
                let spineT = "";
                for (let i = 0; i < 8; i++) {
                    const yBase = (i * 12) - scrollYThorax + 10;
                    if (yBase > -10 && yBase < 110) {
                        spineT += `<rect x="${44 + spineOffset}" y="${yBase}" width="12" height="10" rx="2" fill="#eee" opacity="0.8" />`;
                    }
                }
                const heartOpacity = Math.max(0, Math.cos(orbital_slide) * 0.3);
                const heart = `<ellipse cx="${60 + spineOffset}" cy="60" rx="20" ry="25" fill="#eee" opacity="${heartOpacity}" filter="url(#blur)" />`;
                svgContent = ribs + spineT + heart;
                break;

            case 'abdomen':
            case 'pelvis': // Sharing style for now, but pelvis has wings
                // Lumbar Spine & Pelvis Wings
                const scrollYAbs = (cart_x % 0.2) * 400;
                let spineL = "";
                for (let i = 0; i < 5; i++) {
                    const yBase = (i * 16) - scrollYAbs + 10;
                    if (yBase > -10 && yBase < 110) {
                        spineL += `<rect x="${42 + spineOffset}" y="${yBase}" width="16" height="14" rx="3" fill="#eee" opacity="0.9" />`;
                    }
                }
                // Pelvis Wings (visible if lower abdomen or pelvis)
                let pelvisW = "";
                if (zone.key === 'pelvis' || cart_x > 1.9) {
                    pelvisW = `
                    <path d="M ${50 + spineOffset} 60 Q ${10} 60 ${15} 100" stroke="#ddd" stroke-width="15" fill="none" opacity="0.7" filter="url(#blur)" />
                    <path d="M ${50 + spineOffset} 60 Q ${90} 60 ${85} 100" stroke="#ddd" stroke-width="15" fill="none" opacity="0.7" filter="url(#blur)" />
                    `;
                }
                svgContent = spineL + pelvisW;
                break;

            case 'shoulder':
                svgContent = `
                <!-- Clavicle -->
                <path d="M ${20 + spineOffset} 30 Q ${50 + spineOffset} 40 ${80 + spineOffset} 30" stroke="${boneFill}" stroke-width="8" opacity="${boneOpacity}" filter="url(#blur)" />
                <!-- Scapula Hint -->
                <path d="M ${60 + spineOffset} 40 L ${80 + spineOffset} 80 L ${50 + spineOffset} 70 Z" fill="${boneFill}" opacity="0.5" filter="url(#blur)" />
                <!-- Humeral Head -->
                <circle cx="${80 + spineOffset}" cy="40" r="12" fill="${boneFill}" opacity="${jointOpacity}" filter="url(#blur)" />
                `;
                break;

            case 'humerus':
                svgContent = `
                <!-- Humerus Shaft -->
                <rect x="${42 + spineOffset}" y="-10" width="14" height="120" rx="5" fill="${boneFill}" opacity="${boneOpacity}" filter="url(#blur)" />
                <rect x="${46 + spineOffset}" y="-10" width="6" height="120" rx="2" fill="#fff" opacity="0.2" />
                `;
                break;

            case 'forearm':
                svgContent = `
                <!-- Radius -->
                <rect x="${35 + spineOffset}" y="-10" width="10" height="120" rx="3" fill="${boneFill}" opacity="${boneOpacity}" filter="url(#blur)" />
                <!-- Ulna -->
                <rect x="${55 + spineOffset}" y="-10" width="8" height="120" rx="3" fill="${boneFill}" opacity="${boneOpacity}" filter="url(#blur)" />
                `;
                break;

            case 'hand':
                svgContent = `
                <!-- Wrist Carpals -->
                <circle cx="${50 + spineOffset}" cy="10" r="15" fill="${boneFill}" opacity="${jointOpacity}" filter="url(#blur)" />
                <!-- Metacarpals (5 bones) -->
                ${[0, 1, 2, 3, 4].map(i => `<rect x="${30 + spineOffset + i * 10}" y="30" width="6" height="30" rx="2" fill="${boneFill}" opacity="${boneOpacity}" />`).join('')}
                <!-- Phalanges -->
                ${[0, 1, 2, 3, 4].map(i => `<rect x="${30 + spineOffset + i * 10}" y="65" width="5" height="25" rx="1" fill="${boneFill}" opacity="${boneOpacity}" />`).join('')}
                `;
                break;

            case 'femur':
                svgContent = `
                <!-- Main Femur Shaft -->
                <rect x="${42 + spineOffset}" y="-20" width="18" height="140" rx="6" fill="${boneFill}" opacity="${boneOpacity}" filter="url(#blur)" />
                <!-- Marrow Cavity hint -->
                <rect x="${47 + spineOffset}" y="-10" width="8" height="120" rx="2" fill="#fff" opacity="0.2" />
                `;
                break;

            case 'knee':
                svgContent = `
                <!-- Femur Condyles -->
                <circle cx="${40 + spineOffset}" cy="30" r="15" fill="${boneFill}" opacity="${jointOpacity}" filter="url(#blur)" />
                <circle cx="${60 + spineOffset}" cy="30" r="15" fill="${boneFill}" opacity="${jointOpacity}" filter="url(#blur)" />
                <!-- Tibia Plateau -->
                <rect x="${30 + spineOffset}" y="50" width="40" height="15" rx="4" fill="${boneFill}" opacity="${boneOpacity}" filter="url(#blur)" />
                <!-- Patella Shadow -->
                <circle cx="${50 + spineOffset}" cy="40" r="12" fill="#fff" opacity="0.3" filter="url(#blur)" />
                `;
                break;

            case 'tibia':
                svgContent = `
                <!-- Tibia (Thicker) -->
                <rect x="${35 + spineOffset}" y="-20" width="14" height="140" rx="4" fill="${boneFill}" opacity="${boneOpacity}" filter="url(#blur)" />
                <!-- Fibula (Thinner) -->
                <rect x="${60 + spineOffset}" y="-20" width="6" height="140" rx="3" fill="${boneFill}" opacity="0.7" filter="url(#blur)" />
                `;
                break;

            case 'ankle':
                svgContent = `
                <!-- Tibia/Fibula Ends -->
                <rect x="${35 + spineOffset}" y="10" width="14" height="40" rx="4" fill="${boneFill}" opacity="${boneOpacity}" filter="url(#blur)" />
                <rect x="${60 + spineOffset}" y="10" width="6" height="40" rx="3" fill="${boneFill}" opacity="0.7" filter="url(#blur)" />
                <!-- Talus Dome -->
                <path d="M ${30 + spineOffset} 60 Q ${50 + spineOffset} 45 ${70 + spineOffset} 60" stroke="${boneFill}" stroke-width="10" fill="none" opacity="${jointOpacity}" filter="url(#blur)" />
                `;
                break;

            case 'foot':
                svgContent = `
                <!-- Tarsals Cluster -->
                <path d="M ${30 + spineOffset} 20 Q ${70 + spineOffset} 10 ${70 + spineOffset} 50 Q ${30 + spineOffset} 60 ${30 + spineOffset} 20" fill="${boneFill}" opacity="${boneOpacity}" filter="url(#blur)" />
                <!-- Metatarsals -->
                ${[0, 1, 2, 3, 4].map(i => `<rect x="${30 + spineOffset + i * 8}" y="60" width="5" height="30" rx="1" fill="${boneFill}" opacity="${boneOpacity}" />`).join('')}
                `;
                break;

            default:
                // Fallback (Generic Bone)
                svgContent = `<rect x="${45 + spineOffset}" y="0" width="10" height="100" fill="${boneFill}" opacity="0.5" />`;
                break;
        }

        // Update UI state with anatomy name
        setCurrentAnatomy(anatomyType);

        // Common Noise & Overlay
        const svgString = `
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 100 100">
        <defs>
          <filter id="blur"><feGaussianBlur in="SourceGraphic" stdDeviation="1.5" /></filter>
          <filter id="noise">
            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch" />
            <feComponentTransfer><feFuncA type="table" tableValues="0 0.2" /></feComponentTransfer>
          </filter>
        </defs>
        
        <!-- Background -->
        <rect width="100" height="100" fill="#050505" />
        
        <!-- Generated Anatomy Content -->
        <g transform="rotate(${-wig_wag * 20}, 50, 50)">
            ${svgContent}
        </g>

        <!-- Noise Overlay -->
        <rect width="100" height="100" filter="url(#noise)" opacity="0.5" />
        
        <!-- Metadata Overlay -->
        <g opacity="0.8" font-family="monospace" font-size="4">
          <text x="4" y="8" fill="#00ff00">kVp: 78</text>
          <text x="4" y="14" fill="#00ff00">mA: 4.2</text>
          <text x="65" y="8" fill="#fff" opacity="0.7">${anatomyType}</text>
          <text x="65" y="14" fill="#fff" opacity="0.5">${orbital_slide > 0.2 || orbital_slide < -0.2 ? 'OBL/LAT' : 'AP'}</text>
        </g>
        
        <!-- Orientation Marker -->
        <circle cx="92" cy="92" r="3" fill="none" stroke="#fff" stroke-width="0.5" opacity="0.5" />
        <text x="89" y="93.5" fill="#fff" font-size="3" opacity="0.5">R</text>
      </svg>
    `;

        return `data:image/svg+xml;base64,${btoa(svgString)}`;
    };

    const handleDownloadXray = () => {
        if (!lastXray) return;
        try {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 1024;
                canvas.height = 1024;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;

                // Fill black background (x-rays are usually black/white)
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Draw image
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                canvas.toBlob((blob) => {
                    if (!blob) return;
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;

                    // Format: xray_YYYY-MM-DDTHH-mm-ss-sssZ.png
                    // Simplified ISO format replacement for clean filename
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    link.download = `xray_${timestamp}.png`;

                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                }, 'image/png');
            };
            img.src = lastXray;
        } catch (e) {
            console.error("Download failed", e);
        }
    };

    const handleTakeXray = () => {
        const shotControls = { ...controls };
        const regionKeyAtShot = beamHitRef.current ? beamZoneKeyRef.current : "miss";

        setBeamActive(true);
        setTimeout(() => {
            try {
                setLastXray(generateRealisticXray(shotControls, regionKeyAtShot));
            } catch (e) {
                console.error("Xray Gen Error", e);
            }
            setBeamActive(false);
        }, 450);
    };

    useEffect(() => {
        const handleKeyDown = (e) => {
            // Toggle Debug
            if (e.key.toLowerCase() === 'd') {
                setDebugEnabled(prev => {
                    const next = !prev;
                    debugEnabledRef.current = next;
                    return next;
                });
            }
            // Toggle Landmarks
            if (e.key.toLowerCase() === 'l') {
                showLandmarksRef.current = !showLandmarksRef.current;
                console.log("Landmarks Toggled:", showLandmarksRef.current);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    useEffect(() => {
        if (!mountRef.current) return;

        // --- SETUP ---
        const width = mountRef.current.clientWidth;
        const height = mountRef.current.clientHeight;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xeef2f5);
        let mounted = true; // Prevents race conditions / strict mode dual load

        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
        camera.position.set(0, 1.6, 2.5); // Standing height, 2m from patient's feet

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        rendererRef.current = renderer;
        renderer.setSize(width, height);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        while (mountRef.current.firstChild) mountRef.current.removeChild(mountRef.current.firstChild);
        mountRef.current.appendChild(renderer.domElement);

        const orbit = new OrbitControls(camera, renderer.domElement);
        orbit.enableDamping = true;
        orbit.target.set(0, 1.0, 0.5); // Looking at patient's feet area

        const ambient = new THREE.AmbientLight(0xffffff, 0.7);
        scene.add(ambient);
        const sun = new THREE.DirectionalLight(0xffffff, 1.2);
        sun.position.set(5, 10, 5);
        sun.castShadow = true;
        sun.shadow.mapSize.width = 2048;
        sun.shadow.mapSize.height = 2048;
        scene.add(sun);

        // --- FLOOR ---
        const floorLoader = new THREE.TextureLoader();
        const marbleTexture = floorLoader.load('/marbleFloor.jpg');
        marbleTexture.wrapS = THREE.RepeatWrapping;
        marbleTexture.wrapT = THREE.RepeatWrapping;
        marbleTexture.repeat.set(4, 4); // Tile 4x4 times

        const floorMaterial = new THREE.MeshStandardMaterial({
            map: marbleTexture,
            roughness: 0.1, // Shiny
            metalness: 0.1
        });

        const floor = new THREE.Mesh(new THREE.PlaneGeometry(15, 15), floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);

        // Walls (15x15 room, 3m height)
        const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.8, side: THREE.DoubleSide });
        const wallHeight = 3;

        // North wall (positive Z)
        const wallNorth = new THREE.Mesh(new THREE.PlaneGeometry(15, wallHeight), wallMaterial);
        wallNorth.position.set(0, wallHeight / 2, 7.5);
        wallNorth.receiveShadow = true;
        scene.add(wallNorth);

        // South wall (negative Z)
        const wallSouth = new THREE.Mesh(new THREE.PlaneGeometry(15, wallHeight), wallMaterial);
        wallSouth.position.set(0, wallHeight / 2, -7.5);
        wallSouth.rotation.y = Math.PI;
        wallSouth.receiveShadow = true;
        scene.add(wallSouth);

        // East wall (positive X)
        const wallEast = new THREE.Mesh(new THREE.PlaneGeometry(15, wallHeight), wallMaterial);
        wallEast.position.set(7.5, wallHeight / 2, 0);
        wallEast.rotation.y = -Math.PI / 2;
        wallEast.receiveShadow = true;
        scene.add(wallEast);

        // West wall (negative X)
        const wallWest = new THREE.Mesh(new THREE.PlaneGeometry(15, wallHeight), wallMaterial);
        wallWest.position.set(-7.5, wallHeight / 2, 0);
        wallWest.rotation.y = Math.PI / 2;
        wallWest.receiveShadow = true;
        scene.add(wallWest);

        // Wall Decorations - Horizontal Stripes
        const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0xe8eef2, roughness: 0.7 });
        const stripeHeight = 0.15;
        const stripeY = 1.2;

        // Stripe on North wall
        const stripeNorth = new THREE.Mesh(new THREE.PlaneGeometry(15, stripeHeight), stripeMaterial);
        stripeNorth.position.set(0, stripeY, 7.51);
        scene.add(stripeNorth);

        // Stripe on South wall
        const stripeSouth = new THREE.Mesh(new THREE.PlaneGeometry(15, stripeHeight), stripeMaterial);
        stripeSouth.position.set(0, stripeY, -7.51);
        stripeSouth.rotation.y = Math.PI;
        scene.add(stripeSouth);

        // Stripe on East wall
        const stripeEast = new THREE.Mesh(new THREE.PlaneGeometry(15, stripeHeight), stripeMaterial);
        stripeEast.position.set(7.51, stripeY, 0);
        stripeEast.rotation.y = -Math.PI / 2;
        scene.add(stripeEast);

        // Stripe on West wall
        const stripeWest = new THREE.Mesh(new THREE.PlaneGeometry(15, stripeHeight), stripeMaterial);
        stripeWest.position.set(-7.51, stripeY, 0);
        stripeWest.rotation.y = Math.PI / 2;
        scene.add(stripeWest);

        // Medical Signage Placeholders (colored rectangles)
        const signMaterial = new THREE.MeshStandardMaterial({ color: 0x4a90e2, roughness: 0.3 });
        const signWidth = 0.8;
        const signHeight = 0.6;

        // Sign on North wall
        const signNorth = new THREE.Mesh(new THREE.PlaneGeometry(signWidth, signHeight), signMaterial);
        signNorth.position.set(-5, 2.2, 7.52);
        scene.add(signNorth);


        // Sign on East wall
        const signEast = new THREE.Mesh(new THREE.PlaneGeometry(signWidth, signHeight), signMaterial);
        signEast.position.set(7.52, 2.2, -5);
        signEast.rotation.y = -Math.PI / 2;
        scene.add(signEast);

        // Logo on North wall
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(
            '/qstssLogo.jpg',
            (texture) => {
                const logoMaterial = new THREE.MeshStandardMaterial({
                    map: texture,
                    transparent: true,
                    roughness: 0.5
                });

                // Logo facing outward (outside of room)
                const logoPlaneOut = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), logoMaterial);
                logoPlaneOut.position.set(4, 2, 7.52);
                scene.add(logoPlaneOut);

                // Logo facing inward (inside of room)
                const logoPlaneIn = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), logoMaterial.clone());
                logoPlaneIn.position.set(4, 2, 7.48);
                logoPlaneIn.rotation.y = Math.PI; // Rotate 180 degrees to face inward
                scene.add(logoPlaneIn);
            },
            undefined,
            (error) => {
                console.warn('Logo texture not found. Please add logo.png to the public folder.');
            }
        );

        // MOEHE Logo on North wall (inside, next to QSTSS logo)
        const textureLoader2 = new THREE.TextureLoader();
        textureLoader2.load(
            '/MOEHElogo.jpg',
            (texture) => {
                const moeheMaterial = new THREE.MeshStandardMaterial({
                    map: texture,
                    transparent: true,
                    roughness: 0.5
                });

                // Logo facing inward (inside of room)
                const moehePlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), moeheMaterial);
                moehePlane.position.set(0, 2, 7.48); // Positioned to the left of QSTSS logo
                moehePlane.rotation.y = Math.PI; // Rotate 180 degrees to face inward
                scene.add(moehePlane);
            },
            undefined,
            (error) => {
                console.warn('MOEHE logo texture not found.');
            }
        );




        // --- DEBUG MARKER ---
        const isoMarker = new THREE.Mesh(
            new THREE.SphereGeometry(0.05, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0xff00ff })
        );
        isoMarker.position.copy(ISO_WORLD);
        scene.add(isoMarker);
        isoMarker.add(new THREE.AxesHelper(0.2));

        // --- VISUAL DEBUG HELPERS ---
        // 1. Ray Line (Source -> Detector) - Red
        const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]);
        const rayLine = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: 0xff0000 }));
        rayLine.visible = false;
        scene.add(rayLine);

        // 2. Closest Point Marker (on Ray) - Yellow
        const closestPtMarker = new THREE.Mesh(
            new THREE.SphereGeometry(0.04, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0xffff00 })
        );
        closestPtMarker.visible = false;
        scene.add(closestPtMarker);

        // 3. Connector Line (Iso -> Closest Point) - Green
        const connGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]);
        const connLine = new THREE.Line(connGeo, new THREE.LineBasicMaterial({ color: 0x00ff00 }));
        connLine.visible = false;
        scene.add(connLine);

        // --- SKELETON DEBUG GROUP ---
        const skelGroup = new THREE.Group();
        skelGroup.visible = false; // Managed manually
        scene.add(skelGroup);
        skeletonDebugRef.current = skelGroup;

        // Create Spheres for LANDMARKS
        // Create Spheres for LANDMARKS
        Object.keys(LANDMARKS_NORM).forEach(key => {
            const sphere = new THREE.Mesh(
                new THREE.SphereGeometry(0.015, 8, 8),
                new THREE.MeshBasicMaterial({ color: 0x00ffff, depthTest: false }) // Cyan, X-ray style
            );
            sphere.renderOrder = 999;
            sphere.name = key;
            skelGroup.add(sphere);
        });

        // Create lines for edges
        EDGES.forEach(edge => {
            const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
            const mat = new THREE.LineBasicMaterial({ color: 0x00aaaa, transparent: true, opacity: 0.5, depthTest: false });
            const line = new THREE.Line(geo, mat);
            line.renderOrder = 998;
            line.name = edge.join('-'); // Use a unique name for the edge line
            skelGroup.add(line);
        });

        // --- MATERIALS ---
        const matWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
        const matOrange = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.2 });
        const matDark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
        const matCarbon = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.3 });
        const matSteel = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3, metalness: 0.6 });
        const matBlue = new THREE.MeshStandardMaterial({ color: 0x0077ff, emissive: 0x0022aa, emissiveIntensity: 0.5 });

        // --- BED ---
        const bedGroup = new THREE.Group();
        scene.add(bedGroup);

        const tableTop = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.05, 2.0, 4, 0.01), matBlue);
        tableTop.position.y = 1.35;
        tableTop.receiveShadow = true;
        bedGroup.add(tableTop);

        const legGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.35, 16);
        [{ x: 0.25, z: 0.9 }, { x: -0.25, z: 0.9 }, { x: 0.25, z: -0.9 }, { x: -0.25, z: -0.9 }].forEach(pos => {
            const leg = new THREE.Mesh(legGeo, matSteel);
            leg.position.set(pos.x, 0.675, pos.z);
            leg.castShadow = true;
            bedGroup.add(leg);
        });

        // Force Initial Render to prevent black screen if models fail
        renderer.render(scene, camera);
        hasRenderedInitialRef.current = true;

        // --- LOAD MODELS (Promise-based) ---
        const loader = new GLTFLoader();
        const loadModel = (url) => new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));

        Promise.all([
            loadModel(PATIENT_URL),
            loadModel(CARM_URL),
            loadModel(realsense_URL)
        ]).then(([patientGltf, carmGltf, rsGltf]) => {
            if (!mounted) return;

            // 1. Patient
            const patientModel = patientGltf.scene;
            // Capture Local Bounds (before transform)
            const patientBox = new THREE.Box3().setFromObject(patientModel);
            patientBoundsRef.current = {
                ready: true,
                minX: patientBox.min.x, maxX: patientBox.max.x,
                minY: patientBox.min.y, maxY: patientBox.max.y,
                minZ: patientBox.min.z, maxZ: patientBox.max.z
            };
            patientModelRef.current = patientModel;

            const patientSize = new THREE.Vector3();
            patientBox.getSize(patientSize);
            const maxDimP = Math.max(patientSize.x, patientSize.y, patientSize.z);
            if (maxDimP > 0) {
                const scale = 1.7 / maxDimP;
                patientModel.scale.set(scale, scale, scale);
            }
            patientModel.rotation.set(-Math.PI / 2, 0, Math.PI);
            patientModel.position.set(0, 1.50, 0.0);
            patientModel.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
            bedGroup.add(patientModel);

            // 2. Extra C-Arm
            const carmModel = carmGltf.scene;
            // cArmModelRef.current = carmModel; // Unused
            carmModel.position.set(1.5, 0, -2.0);
            carmModel.traverse(n => {
                if (n.isMesh) {
                    n.castShadow = true;
                    n.receiveShadow = true;
                    n.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.2 });
                }
            });
            scene.add(carmModel);

            // 3. Realsense
            const rsModel = rsGltf.scene;
            const rsBox = new THREE.Box3().setFromObject(rsModel);
            const rsSize = new THREE.Vector3();
            rsBox.getSize(rsSize);
            const maxDimR = Math.max(rsSize.x, rsSize.y, rsSize.z);
            if (maxDimR > 0) {
                const scale = 0.15 / maxDimR;
                rsModel.scale.set(scale, scale, scale);
            } else {
                rsModel.scale.set(0.15, 0.15, 0.15);
            }

            // Attach directly to C-Arm Slide (Orbital Frame) so it moves with it
            // Local Position on the Arc (Near Detector)
            // Detector is at Y ~= 0.8 (cRadius). 
            // We place Camera slightly offset.
            if (cArmSlideRef.current) {
                cArmSlideRef.current.add(rsModel);
                // Local Coords relative to C-Slide center
                rsModel.position.set(0.1, 0.95, 0.0);
                rsModel.rotation.set(Math.PI / 2, 0, Math.PI);
            } else {
                scene.add(rsModel); // Fallback
            }

            rsModel.updateMatrixWorld(true);

            rsModel.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });

            // Store realsense model reference
            realsenseModelRef.current = rsModel;

            setModelLoading(false);
        }).catch(err => {
            if (!mounted) return;
            console.error("Model Load Error", err);
            setModelLoading(false);
        });

        // --- ROBOT CART (Procedural) ---
        const cartRoot = new THREE.Group();
        cartRoot.position.set(1.5, 0, 0);
        cartRoot.rotation.y = -Math.PI / 2;
        scene.add(cartRoot);
        cartRef.current = cartRoot;

        const chassis = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.5, 1.1, 4, 0.05), matWhite);
        chassis.position.y = 0.35;
        chassis.castShadow = true;
        cartRoot.add(chassis);
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.02, 1.12), matOrange);
        stripe.position.y = 0.6;
        cartRoot.add(stripe);
        // Using Sphere for wheels instead of Cylinder
        [{ x: 0.35, z: 0.35 }, { x: -0.35, z: 0.35 }, { x: 0.35, z: -0.35 }, { x: -0.35, z: -0.35 }].forEach(pos => {
            const cover = new THREE.Mesh(new THREE.SphereGeometry(0.16, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), matWhite);
            cover.position.set(pos.x, 0.15, pos.z);
            cartRoot.add(cover);
        });

        // --- KINEMATICS (Procedural) ---
        const colBaseGroup = new THREE.Group();
        colBaseGroup.position.set(0, 0.6, 0.45);
        cartRoot.add(colBaseGroup);

        const colRotGroup = new THREE.Group();
        colBaseGroup.add(colRotGroup);
        columnRotRef.current = colRotGroup;

        const columnMesh = new THREE.Mesh(new RoundedBoxGeometry(0.25, 1.15, 0.25, 4, 0.02), matWhite);
        columnMesh.position.y = 0.575;
        colRotGroup.add(columnMesh);

        const liftGroup = new THREE.Group();
        colRotGroup.add(liftGroup);
        liftRef.current = liftGroup;

        const shoulderGroup = new THREE.Group();
        shoulderGroup.position.z = 0.2;
        liftGroup.add(shoulderGroup);
        const holderBlock = new THREE.Mesh(new RoundedBoxGeometry(0.35, 0.4, 0.4, 4, 0.05), matWhite);
        holderBlock.castShadow = true;
        shoulderGroup.add(holderBlock);

        const wigWagGroup = new THREE.Group();
        wigWagGroup.position.z = 0.25;
        shoulderGroup.add(wigWagGroup);
        wigWagRef.current = wigWagGroup;

        const cRadius = 0.8;
        const cSlideGroup = new THREE.Group();
        cSlideGroup.position.set(0, 0, cRadius);
        wigWagGroup.add(cSlideGroup);
        cArmSlideRef.current = cSlideGroup;

        const torusGeo = new THREE.TorusGeometry(cRadius, 0.12, 16, 100, Math.PI);
        const cArmMesh = new THREE.Mesh(torusGeo, matWhite);
        cArmMesh.rotation.y = Math.PI / 2;
        cArmMesh.scale.z = 0.4;
        cArmMesh.rotation.z = -Math.PI / 2;
        cArmMesh.castShadow = true;
        cSlideGroup.add(cArmMesh);

        const strip = new THREE.Mesh(new THREE.TorusGeometry(cRadius, 0.125, 4, 100, Math.PI), matBlue);
        strip.rotation.y = Math.PI / 2;
        strip.scale.z = 0.1;
        strip.rotation.z = -Math.PI / 2;
        cSlideGroup.add(strip);

        // --- DETECTOR ---
        const detGroup = new THREE.Group();
        detGroup.position.set(0, cRadius, 0);
        cSlideGroup.add(detGroup);

        const detHousing = new THREE.Group();
        detHousing.rotation.set(Math.PI, 0, 0);
        detGroup.add(detHousing);

        const detNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.05, 32), matWhite);
        detNeck.position.y = 0.025;
        detHousing.add(detNeck);
        const detCollar = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.02, 16, 32), matWhite);
        detCollar.rotation.x = Math.PI / 2;
        detCollar.position.y = 0.0;
        detHousing.add(detCollar);
        const detBody = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.25, 32), matWhite);
        detBody.position.y = 0.175;
        detHousing.add(detBody);
        const detBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 32), matWhite);
        detBrim.position.y = 0.10;
        detHousing.add(detBrim);
        const detFace = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.01, 32), new THREE.MeshStandardMaterial({ color: 0x111111 }));
        detFace.position.y = 0.30;
        detHousing.add(detFace);

        // DETECTOR ANCHOR
        const detAnchor = detAnchorRef.current;
        detAnchor.position.y = 0.3;
        detHousing.add(detAnchor);

        // --- SOURCE ---
        const srcGroup = new THREE.Group();
        srcGroup.position.set(0, -cRadius, 0);
        cSlideGroup.add(srcGroup);

        const srcHousing = new THREE.Group();
        srcGroup.add(srcHousing);

        const srcCap = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.05, 0.36, 2, 0.01), matWhite);
        srcCap.position.y = 0.025;
        srcHousing.add(srcCap);
        const srcBox = new THREE.Mesh(new RoundedBoxGeometry(0.35, 0.4, 0.4, 4, 0.05), matWhite);
        srcBox.position.y = 0.05;
        srcHousing.add(srcBox);
        const coll = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 0.15), matDark);
        coll.position.y = 0.26;
        srcHousing.add(coll);

        // SOURCE ANCHOR
        const srcAnchor = srcAnchorRef.current;
        srcAnchor.position.y = 0.26;
        srcHousing.add(srcAnchor);

        // BEAM PHYSICS
        // Create frustum: Source at y=0 (bottom), Detector at y=1 (top)
        // Cylinder base (bottom) is at -0.5, top at +0.5.
        // We want Apex at 0 (Source) and Base at 1 (Detector).
        // RadiusTop = 1 (Detector end), RadiusBottom = 0.05 (Source end, collimated).
        const beamGeo = new THREE.CylinderGeometry(1, 0.05, 1, 4, 1, true);
        beamGeo.translate(0, 0.5, 0); // Shift so bottom (Source) is at 0, top (Detector) is at 1
        beamGeo.rotateY(Math.PI / 4); // Align square profile to axes

        const beamMat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false });
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.visible = false; // Start hidden

        // Attach to scene root to avoid parent transform issues (we will position/orient in world space)
        scene.add(beam);
        beamRef.current = beam;

        // --- DEPTH RENDERING SETUP ---
        // Depth Render Target (Depth Capture)
        const depthRenderTarget = new THREE.WebGLRenderTarget(512, 512); // Higher res + scaling
        depthRenderTarget.depthTexture = new THREE.DepthTexture();
        depthRenderTarget.depthTexture.type = THREE.UnsignedShortType; // Standard depth
        depthRenderTargetRef.current = depthRenderTarget;

        // Depth Visualization Setup (Quad + Shader) to convert depth to grayscale
        const depthVizScene = new THREE.Scene();
        // Ortho camera for full screen quad
        const depthVizCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const depthVizMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tDepth: { value: depthRenderTarget.depthTexture },
                cameraNear: { value: 0.1 },
                cameraFar: { value: 2.5 }
            },
            vertexShader: `
                 varying vec2 vUv;
                 void main() {
                     vUv = uv;
                     gl_Position = vec4(position, 1.0);
                 }
             `,
            fragmentShader: `
                 #include <packing>
                 varying vec2 vUv;
                 uniform sampler2D tDepth;
                 uniform float cameraNear;
                 uniform float cameraFar;

                 float readDepth( sampler2D depthSampler, vec2 coord ) {
                     float fragCoordZ = texture2D( depthSampler, coord ).x;
                     float viewZ = perspectiveDepthToViewZ( fragCoordZ, cameraNear, cameraFar );
                     return viewZToOrthographicDepth( viewZ, cameraNear, cameraFar );
                 }
                 
                 void main() {
                     // Get linearized depth (0 = near, 1 = far)
                     float depth = readDepth( tDepth, vUv );
                     
                     // Invert so Near is White, Far is Black
                     float val = 1.0 - depth; 
                     
                     // Increase Contrast using Power Curve
                     // val is initially [0, 1]. pow(val, 3.0) pushes mid-tones darker.
                     // Since we reduced Far to 2.5, patient (0.5m) is ~0.8.
                     // 0.8^3 = 0.51.
                     // Floor (1.5m) is ~0.4.
                     // 0.4^3 = 0.06.
                     // Contrast difference: 0.45. Huge!
                     
                     val = pow(val, 3.0);

                     gl_FragColor = vec4( vec3( val ), 1.0 );
                 }
             `
        });
        const depthVizQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), depthVizMaterial);
        depthVizScene.add(depthVizQuad);
        depthVizSceneRef.current = depthVizScene;
        depthVizQuadRef.current = depthVizQuad;

        // Target to render the visualization into (RGBA)
        const depthVizTarget = new THREE.WebGLRenderTarget(256, 256);
        depthVizTargetRef.current = depthVizTarget;

        const depthCamera = new THREE.PerspectiveCamera(58, 1, 0.1, 2.5);
        depthCameraRef.current = depthCamera;

        // DEBUG: Add CameraHelper to visualize orientation
        const helper = new THREE.CameraHelper(depthCamera);
        scene.add(helper);
        depthCameraHelperRef.current = helper;

        // Vectors (Allocated ONCE)
        const v1 = new THREE.Vector3();
        const v2 = new THREE.Vector3();
        const vSeg = new THREE.Vector3(); // Scratch AB
        const vecToI = new THREE.Vector3(); // Scratch AP
        const closestPoint = new THREE.Vector3(); // Clamped result
        const tempVec = new THREE.Vector3(); // Unclamped result / Midpoint scratch
        const dir = new THREE.Vector3(); // Beam direction scratch
        const yAxis = new THREE.Vector3(0, 1, 0); // Reference UP for beam
        const beamAxisWorld = new THREE.Vector3(); // For debug check

        // Raycasting Allocations
        const rayFwd = new THREE.Ray();
        const rayBack = new THREE.Ray();
        const boxEntry = new THREE.Vector3();
        const boxExit = new THREE.Vector3();
        const boxMid = new THREE.Vector3();
        const patientBoxWorld = new THREE.Box3();

        // --- NEW PRE-ALLOCATIONS FOR ROBUST ZONING ---
        const localV1 = new THREE.Vector3();
        const localV2 = new THREE.Vector3();
        const localDir = new THREE.Vector3();
        const localBox = new THREE.Box3();
        const entryLocal = new THREE.Vector3();
        const exitLocal = new THREE.Vector3();
        const rayLocal = new THREE.Ray();
        const sampleLocal = new THREE.Vector3(); // Reused for sampling

        let reqId;
        const animate = () => {
            reqId = requestAnimationFrame(animate);

            try {
                orbit.update();

                // PHYSICS LOOP
                if (srcAnchorRef.current && detAnchorRef.current && beamRef.current) {
                    srcAnchorRef.current.getWorldPosition(v1);
                    detAnchorRef.current.getWorldPosition(v2);
                    const distance = v1.distanceTo(v2);

                    // Beam Logic (World Space Alignment)
                    dir.subVectors(v2, v1);
                    const sid = dir.length();
                    dir.normalize();

                    beamRef.current.visible = beamActiveRef.current;
                    beamRef.current.position.copy(v1);
                    beamRef.current.quaternion.setFromUnitVectors(yAxis, dir);
                    beamRef.current.scale.set(0.2, sid, 0.2);


                    // --- DEBUG UPDATE ---
                    if (debugEnabledRef.current) {
                        if (isoMarker) isoMarker.visible = true;
                        rayLine.visible = true;
                        closestPtMarker.visible = true;
                        connLine.visible = true;

                        // Update Ray Line
                        const positions = rayLine.geometry.attributes.position.array;
                        v1.toArray(positions, 0);
                        v2.toArray(positions, 3);
                        rayLine.geometry.attributes.position.needsUpdate = true;

                        // Calc Geometry
                        const t = projectPointToLineParamsInto(ISO_WORLD, v1, v2, tempVec, vSeg, vecToI);
                        const tClamped = Math.max(0, Math.min(1, t));
                        closestPoint.copy(v1).addScaledVector(vSeg, tClamped);
                        closestPtMarker.position.copy(closestPoint);

                        // Update Connector
                        const connPos = connLine.geometry.attributes.position.array;
                        ISO_WORLD.toArray(connPos, 0);
                        closestPoint.toArray(connPos, 3);
                        connLine.geometry.attributes.position.needsUpdate = true;
                    } else {
                        if (isoMarker) isoMarker.visible = false;
                        rayLine.visible = false;
                        closestPtMarker.visible = false;
                        connLine.visible = false;
                    }

                    const now = performance.now();
                    if (now - lastDebugUpdateRef.current > 100) { // 10Hz
                        lastDebugUpdateRef.current = now;

                        // --- 1. ALWAYS COMPUTE BEAM REGION (Physics) ---
                        const bounds = patientBoundsRef.current;
                        let zoneResult = ZONE_DEFS.miss;
                        let isHitting = false;

                        if (patientModelRef.current && bounds.ready) {
                            // --- OBB-STYLE INTERSECTION (Patient Local Space) ---
                            patientModelRef.current.updateMatrixWorld(true);

                            localV1.copy(v1); // SRC
                            patientModelRef.current.worldToLocal(localV1);

                            localV2.copy(v2); // DET
                            patientModelRef.current.worldToLocal(localV2);

                            localDir.subVectors(localV2, localV1);
                            const localSid = localDir.length();
                            localDir.normalize();
                            rayLocal.set(localV1, localDir);

                            localBox.min.set(bounds.minX, bounds.minY, bounds.minZ);
                            localBox.max.set(bounds.maxX, bounds.maxY, bounds.maxZ);

                            const hitEntry = rayLocal.intersectBox(localBox, entryLocal);

                            if (hitEntry) {
                                const distEntry = entryLocal.distanceTo(localV1);
                                if (distEntry <= localSid) {
                                    isHitting = true;

                                    tempVec.copy(localDir).multiplyScalar(-1);
                                    rayLocal.set(localV2, tempVec);
                                    const hitExit = rayLocal.intersectBox(localBox, exitLocal);
                                    if (!hitExit) exitLocal.copy(entryLocal);

                                    const distExitFromDet = exitLocal.distanceTo(localV2);
                                    const tEntry = distEntry / localSid;
                                    const tExit = 1.0 - (distExitFromDet / localSid);
                                    const tStart = Math.max(0, tEntry);
                                    const tEnd = Math.min(1, tExit);

                                    if (tEnd > tStart) {
                                        // --- MULTI-POINT SAMPLING (STRICT SKELETON) ---
                                        const SAMPLES = 9;
                                        const counts = Object.create(null);
                                        let bestSampleEdge = "";
                                        let bestSampleD2 = Infinity;

                                        // 1. Build Local Landmarks (With Offsets)
                                        const axes = getInferredPatientAxes(bounds);
                                        const localLandmarks = {};
                                        Object.keys(LANDMARKS_NORM).forEach(key => {
                                            localLandmarks[key] = landmarkLocal(key, bounds, axes);
                                        });

                                        for (let i = 0; i < SAMPLES; i++) {
                                            const t = (SAMPLES > 1) ? (tStart + (tEnd - tStart) * (i / (SAMPLES - 1))) : (tStart + tEnd) * 0.5;
                                            sampleLocal.copy(localDir).multiplyScalar(t * localSid).add(localV1);

                                            // 2. Classify
                                            const res = classifyLocalPointBySkeleton(sampleLocal, localLandmarks);

                                            // 3. Vote (Weight = 1 / d^2)
                                            const weight = 1.0 / (res.d2 + 1e-4);
                                            counts[res.zone.key] = (counts[res.zone.key] || 0) + weight;

                                            if (res.d2 < bestSampleD2) {
                                                bestSampleD2 = res.d2;
                                                bestSampleEdge = res.edge;
                                            }
                                        }

                                        // Pick Winner
                                        let bestKey = 'miss';
                                        let bestWeight = -1;
                                        for (const key in counts) {
                                            if (counts[key] > bestWeight) {
                                                bestWeight = counts[key];
                                                bestKey = key;
                                            }
                                        }
                                        zoneResult = ZONE_DEFS[bestKey] || ZONE_DEFS.miss;
                                        beamNormYRef.current = `${bestSampleEdge} d:${Math.sqrt(bestSampleD2).toFixed(3)}`;
                                    }
                                }
                            }
                        }

                        // Update Refs & UI
                        beamZoneKeyRef.current = zoneResult.key;
                        beamRegionRef.current = zoneResult.label;
                        beamHitRef.current = isHitting;
                        if (!isHitting) beamNormYRef.current = null;

                        setBeamRegionUI(zoneResult.label);
                        setBeamZoneKeyUI(zoneResult.key);

                        // --- UPDATE SKELETON DEBUG VISUALS (Toggle 'L') ---
                        if (skeletonDebugRef.current) {
                            // Only visible if 'L' key active (we need to add that state, currently using debugEnabled)
                            // User asked for 'L' toggle. Let's assume debugEnabled covers it for now OR add dedicated state.
                            // Requirement: "Add a toggle key (e.g. 'L') to show/hide landmark spheres."
                            // We need a new state for landmarks. Let's use a ref for now to avoid re-renders?
                            // No, state `showLandmarks` is better.
                            // But for minimal churn, let's piggyback on debugEnabled but filter visibility?
                            // Actually, I should add the toggle.
                            // For now, I'll use `showLandmarksRef.current`. I need to add that ref.

                            skeletonDebugRef.current.visible = showLandmarksRef.current;

                            if (showLandmarksRef.current && patientModelRef.current && bounds.ready) {
                                // Re-compute corrected nodes
                                const axes = getInferredPatientAxes(bounds);
                                const localLandmarks = {};
                                Object.keys(LANDMARKS_NORM).forEach(key => {
                                    localLandmarks[key] = landmarkLocal(key, bounds, axes);
                                });

                                // Render Spheres
                                // Render Debug Objects
                                skeletonDebugRef.current.children.forEach(child => {
                                    // 1. Is it a Landmark?
                                    const local = localLandmarks[child.name];
                                    if (local) {
                                        child.visible = true;
                                        const world = local.clone().applyMatrix4(patientModelRef.current.matrixWorld);
                                        child.position.copy(world);
                                    } else {
                                        // 2. Is it an Edge?
                                        const edge = EDGES.find(e => e.join('-') === child.name);
                                        if (edge) {
                                            const startLocal = localLandmarks[edge[0]];
                                            const endLocal = localLandmarks[edge[1]];

                                            if (startLocal && endLocal) {
                                                child.visible = true;
                                                const pos = child.geometry.attributes.position.array;

                                                // Transform to World
                                                const startWorld = startLocal.clone().applyMatrix4(patientModelRef.current.matrixWorld);
                                                const endWorld = endLocal.clone().applyMatrix4(patientModelRef.current.matrixWorld);

                                                startWorld.toArray(pos, 0);
                                                endWorld.toArray(pos, 3);
                                                child.geometry.attributes.position.needsUpdate = true;
                                            } else {
                                                child.visible = false;
                                            }
                                        } else {
                                            // Neither landmark nor edge
                                            child.visible = false;
                                        }
                                    }
                                });
                            }
                        }

                        // --- 2. DEBUG READOUT ---
                        if (debugEnabledRef.current) {
                            // (Keep existing debug readout logic...)
                            // For brevity in replacement, I'll allow the existing readout logic to remain if I didn't cut it.
                            // But I am replacing the block. So I must re-include it.

                            projectPointToLineParamsInto(ISO_WORLD, v1, v2, tempVec, vSeg, vecToI);
                            const isoRayDist = ISO_WORLD.distanceTo(tempVec);
                            const t = projectPointToLineParamsInto(ISO_WORLD, v1, v2, tempVec, vSeg, vecToI);
                            closestPoint.copy(v1).addScaledVector(vSeg, Math.max(0, Math.min(1, t)));
                            const isoSegDist = ISO_WORLD.distanceTo(closestPoint);

                            tempVec.addVectors(v1, v2).multiplyScalar(0.5);
                            const midToIso = tempVec.distanceTo(ISO_WORLD);

                            beamRef.current.updateMatrixWorld();
                            beamAxisWorld.copy(yAxis).applyQuaternion(beamRef.current.quaternion);
                            const angleDeg = beamAxisWorld.angleTo(dir) * 180 / Math.PI;

                            tempVec.set(0, 1, 0).applyMatrix4(beamRef.current.matrixWorld);
                            const beamBaseErr = tempVec.distanceTo(v2);

                            setDebugReadout({
                                src: v1.toArray().map(n => n.toFixed(3)),
                                det: v2.toArray().map(n => n.toFixed(3)),
                                sid: distance.toFixed(3),
                                midToIso: midToIso.toFixed(3),
                                isoRay: isoRayDist.toFixed(3),
                                isoSeg: isoSegDist.toFixed(3),
                                t: t.toFixed(3),
                                beamAngle: angleDeg.toFixed(3),
                                beamErr: beamBaseErr.toFixed(3),
                                beamRegion: zoneResult.label,
                                hitStatus: isHitting ? "HIT" : "MISS",
                                normY: beamNormYRef.current || "NA"
                            });
                        }
                    }
                } // End physics loop

                // --- DEPTH RENDERING ---
                // --- DEPTH RENDERING (DEBUG MODE: MANUAL CONTROL) ---
                if (detAnchorRef.current && srcAnchorRef.current && depthCameraRef.current && depthRenderTargetRef.current) {
                    detAnchorRef.current.updateMatrixWorld(true);
                    srcAnchorRef.current.updateMatrixWorld(true);

                    // Base position: Detector
                    detAnchorRef.current.getWorldPosition(v1); // Detector pos
                    srcAnchorRef.current.getWorldPosition(v2); // Source pos

                    // Calculate Beam Direction (Detector -> Source)
                    dir.subVectors(v2, v1).normalize();

                    // Apply Manual Offsets relative to Beam Frame? No, simplified: World Offsets + Beam Axis
                    // Let's use the UI offsets directly in World Space relative to Detector
                    // EXCEPT Y is along the beam?
                    // User wants "move around". Let's give World Space offsets relative to Detector.

                    // 1. Reset to Detector Position & Orientation
                    detAnchorRef.current.getWorldPosition(depthCameraRef.current.position);
                    detAnchorRef.current.getWorldQuaternion(depthCameraRef.current.quaternion);

                    // 2. Apply Dynamic Offsets (Relative to Detector) for CAMERA
                    const off = camOffsetRef.current;
                    depthCameraRef.current.translateX(off.x);
                    depthCameraRef.current.translateY(off.y);
                    depthCameraRef.current.translateZ(off.z);

                    // 3. Apply Dynamic Rotation for CAMERA
                    const rot = camRotRef.current;
                    depthCameraRef.current.rotateX(rot.x * Math.PI / 180);
                    depthCameraRef.current.rotateY(rot.y * Math.PI / 180);
                    depthCameraRef.current.rotateZ(rot.z * Math.PI / 180);

                    // 4. Apply Dynamic Transforms for REALSENSE (If attached)
                    if (realsenseModelRef.current) {
                        const rsOff = rsOffsetRef.current;
                        const rsR = rsRotRef.current;
                        realsenseModelRef.current.position.set(rsOff.x, rsOff.y, rsOff.z);
                        realsenseModelRef.current.rotation.set(
                            rsR.x * Math.PI / 180,
                            rsR.y * Math.PI / 180,
                            rsR.z * Math.PI / 180
                        );
                    }

                    // --- RENDER PASS 1: CAPTURE DEPTH ---
                    renderer.setRenderTarget(depthRenderTargetRef.current);
                    // Clear mainly depth
                    renderer.clear();
                    renderer.render(scene, depthCameraRef.current);
                    renderer.setRenderTarget(null);

                    // --- RENDER PASS 2: VISUALIZE DEPTH TO TEXTURE ---
                    if (depthVizSceneRef.current && depthVizTargetRef.current) {
                        renderer.setRenderTarget(depthVizTargetRef.current);
                        renderer.render(depthVizSceneRef.current, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)); // Use simple camera
                        renderer.setRenderTarget(null);
                    }

                    depthCameraRef.current.updateMatrixWorld(true);

                    renderer.setRenderTarget(depthRenderTargetRef.current);
                    renderer.render(scene, depthCameraRef.current);
                    renderer.setRenderTarget(null);

                    // Update debug helper
                    // Update debug helper
                    if (depthCameraHelperRef.current) {
                        depthCameraHelperRef.current.visible = debugEnabledRef.current;
                        if (debugEnabledRef.current) {
                            depthCameraHelperRef.current.update();
                        }
                    }
                }



                renderer.render(scene, camera);

            } catch (err) {
                console.error("[animate crash]", err);
                cancelAnimationFrame(reqId);
            }
        };
        animate();

        const handleResize = () => {
            if (!mountRef.current) return;
            const w = mountRef.current.clientWidth;
            const h = mountRef.current.clientHeight;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        };
        window.addEventListener('resize', handleResize);

        return () => {
            mounted = false;
            cancelAnimationFrame(reqId);
            window.removeEventListener('resize', handleResize);
            if (mountRef.current) mountRef.current.innerHTML = '';

            renderer.dispose();
            orbit.dispose();

            if (depthRenderTargetRef.current) {
                depthRenderTargetRef.current.dispose();
            }

            if (depthCameraHelperRef.current) {
                // Remove helper from wherever it might be attached (scene root)
                if (depthCameraHelperRef.current.parent) {
                    depthCameraHelperRef.current.parent.remove(depthCameraHelperRef.current);
                }
            }

            // Dispose scene resources
            scene.traverse((object) => {
                if (object.isMesh) {
                    object.geometry.dispose();
                    if (object.material.isMaterial) {
                        object.material.dispose();
                    } else if (Array.isArray(object.material)) {
                        object.material.forEach(m => m.dispose());
                    }
                }
            });
        };
    }, []);

    useEffect(() => {
        // Lift Logic (Procedural Robot)
        if (liftRef.current) liftRef.current.position.y = 1.20 + controls.lift;
        if (columnRotRef.current) columnRotRef.current.rotation.y = controls.column_rot;
        if (wigWagRef.current) wigWagRef.current.rotation.z = controls.wig_wag;
        if (cArmSlideRef.current) cArmSlideRef.current.rotation.x = controls.orbital_slide;
        if (cartRef.current) {
            cartRef.current.position.x = controls.cart_x;
            cartRef.current.position.z = controls.cart_z; // Apply Lateral Z
        }

        // Removed C-Arm GLB control logic to make it static
    }, [controls]);

    useEffect(() => {
        beamActiveRef.current = beamActive;
    }, [beamActive]);

    // Depth canvas update effect
    useEffect(() => {
        if (!depthCanvasRef.current) return;

        const canvas = depthCanvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Buffer for reading pixels
        const pixelBuffer = new Uint8Array(256 * 256 * 4);

        let animId;
        const updateDepthCanvas = () => {
            if (depthVizTargetRef.current && rendererRef.current) {
                // Read pixels from the VIZ target (Grayscale Depth)
                rendererRef.current.readRenderTargetPixels(
                    depthVizTargetRef.current,
                    0, 0, 256, 256,
                    pixelBuffer
                );

                // Put pixels on canvas
                const imageData = ctx.createImageData(256, 256);
                const data = imageData.data;

                // Copy buffer to imageData (need to flip Y usually, but for debug direct copy is fine)
                for (let i = 0; i < pixelBuffer.length; i++) {
                    data[i] = pixelBuffer[i];
                }

                ctx.putImageData(imageData, 0, 0);
            }

            animId = requestAnimationFrame(updateDepthCanvas);
        };
        updateDepthCanvas();

        return () => {
            if (animId) cancelAnimationFrame(animId);
        };
    }, []);

    const containerStyle = { position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: '#eef2f5', fontFamily: 'sans-serif', color: '#333' };
    const xrayStyle = { position: 'absolute', top: '20px', left: '20px', width: '200px', height: '220px', backgroundColor: '#000', borderRadius: '8px', border: '2px solid #333', display: 'flex', flexDirection: 'column', overflow: 'hidden', pointerEvents: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.3)', color: '#fff' };
    const depthViewerStyle = { position: 'absolute', top: '260px', left: '20px', width: '200px', height: '200px', backgroundColor: '#000', borderRadius: '8px', border: '2px solid #333', display: 'flex', flexDirection: 'column', overflow: 'hidden', pointerEvents: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.3)', color: '#fff' };

    return (
        <div style={containerStyle}>
            <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

            {debugEnabled && debugReadout && (
                <div style={{
                    position: 'absolute', top: '10px', right: '10px',
                    backgroundColor: 'rgba(0, 0, 0, 0.7)', color: '#0f0',
                    padding: '10px', borderRadius: '4px', fontFamily: 'monospace',
                    fontSize: '10px', pointerEvents: 'none', zIndex: 999
                }}>
                    <div><strong>DEBUG INFO</strong></div>
                    <div style={{ color: '#0ff', fontWeight: 'bold' }}>BeamRegion: {debugReadout.beamRegion}</div>
                    <div style={{ fontSize: '9px', color: '#aaa', marginBottom: '4px' }}>
                        Hit: {debugReadout.hitStatus} | NormY: {debugReadout.normY}
                    </div>
                    <hr style={{ borderColor: '#444', margin: '5px 0' }} />
                    <div>SRC: [{debugReadout.src.join(', ')}]</div>
                    <div>DET: [{debugReadout.det.join(', ')}]</div>
                    <div>SID: {debugReadout.sid} m</div>
                    <hr style={{ borderColor: '#444', margin: '5px 0' }} />
                    <div>MidToIso: {debugReadout.midToIso} m</div>
                    <div style={{ color: '#fff' }}>IsoRay: {debugReadout.isoRay} m</div>
                    <div>IsoSeg: {debugReadout.isoSeg} m</div>
                    <div>t: {debugReadout.t}</div>
                    <div>BeamAng: {debugReadout.beamAngle}°</div>
                    <div>BeamBaseErr: {debugReadout.beamErr} m</div>
                    <hr style={{ borderColor: '#444', margin: '5px 0' }} />
                    <div>Lift: {controls.lift.toFixed(3)}</div>
                    <div>C-Rot: {(controls.column_rot * 180 / Math.PI).toFixed(1)}°</div>
                    <div>WigWag: {(controls.wig_wag * 180 / Math.PI).toFixed(1)}°</div>
                    <div>Orbital: {(controls.orbital_slide * 180 / Math.PI).toFixed(1)}°</div>
                    <div>CartX: {controls.cart_x.toFixed(3)}</div>
                    <div>CartZ: {controls.cart_z.toFixed(3)}</div>
                </div>
            )}

            <div style={xrayStyle}>
                <div style={{ backgroundColor: '#111', borderBottom: '1px solid #333', padding: '5px 10px', fontSize: '9px', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', color: '#aaa' }}>
                    <span>FLUORO - LIVE VIEW</span>
                    <span style={{
                        color: beamZoneKeyUI === 'miss' ? '#ff3333' : '#00ffaa',
                        fontWeight: 'bold',
                        marginLeft: '10px'
                    }}>
                        {beamRegionUI}
                    </span>
                    <span>ISO: 1200</span>
                </div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                    {lastXray ? (
                        <img src={lastXray} alt="Xray" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: beamActive ? 'brightness(1.6) contrast(1.1) drop-shadow(0 0 5px white)' : 'none' }} />
                    ) : (
                        <div style={{ color: '#333', fontSize: '9px', letterSpacing: '1px' }}>
                            {beamActive ? "EXPOSING..." : (currentAnatomy === "READY" ? "READY" : currentAnatomy)}
                        </div>
                    )}
                    <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(rgba(255,255,255,0.01) 0px, transparent 1px, transparent 2px)', pointerEvents: 'none' }}></div>
                    <div style={{ position: 'absolute', bottom: '5px', left: '8px', fontSize: '8px', color: '#0f0', opacity: 0.6, fontFamily: 'monospace' }}>FPS: 30</div>
                    <div style={{ position: 'absolute', bottom: '5px', right: '8px', fontSize: '8px', color: '#fff', opacity: 0.4, textAlign: 'right' }}>ID: 4882-991<br />PATIENT: DOE, J</div>

                    {beamActive && (
                        <div style={{ position: 'absolute', top: '20px', right: '10px', color: 'red', fontSize: '9px', fontWeight: 'bold', animation: 'pulse 0.4s infinite' }}>RADIATION ON</div>
                    )}
                </div>
                {/* Download Button Moved Here */}
                <button
                    onClick={handleDownloadXray}
                    disabled={!lastXray || beamActive}
                    style={{
                        width: '100%',
                        padding: '8px',
                        backgroundColor: (!lastXray || beamActive) ? '#222' : '#444',
                        color: (!lastXray || beamActive) ? '#555' : 'white',
                        border: 'none',
                        borderTop: '1px solid #333',
                        fontSize: '9px',
                        fontWeight: 'bold',
                        cursor: (!lastXray || beamActive) ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s'
                    }}>
                    DOWNLOAD X-RAY
                </button>
            </div>

            {/* Depth Viewer */}
            <div style={depthViewerStyle}>
                <div style={{ backgroundColor: '#111', borderBottom: '1px solid #333', padding: '5px 10px', fontSize: '9px', fontWeight: 'bold', color: '#aaa' }}>
                    DEPTH VIEW - X-RAY SOURCE
                </div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' }}>
                    <canvas
                        ref={depthCanvasRef}
                        width={256}
                        height={256}
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                </div>
            </div>

            <ControllerPanel
                controls={controls}
                setControls={setControls}
                onExpose={handleTakeXray}
                onSave={handleDownloadXray}
                beamActive={beamActive}
            />


            {debugEnabled && (
                <div style={{ position: 'absolute', bottom: '10px', left: '10px', backgroundColor: 'rgba(0,0,0,0.8)', padding: '10px', borderRadius: '5px', color: 'white', fontSize: '10px', width: '200px' }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>CONTROLS</span>
                        <div style={{ display: 'flex', gap: '5px' }}>
                            <button
                                onClick={() => setControlTarget('camera')}
                                style={{
                                    padding: '2px 5px', fontSize: '9px', cursor: 'pointer', border: 'none', borderRadius: '3px',
                                    backgroundColor: controlTarget === 'camera' ? '#0077ff' : '#444', color: 'white'
                                }}>
                                CAM
                            </button>
                            <button
                                onClick={() => setControlTarget('realsense')}
                                style={{
                                    padding: '2px 5px', fontSize: '9px', cursor: 'pointer', border: 'none', borderRadius: '3px',
                                    backgroundColor: controlTarget === 'realsense' ? '#0077ff' : '#444', color: 'white'
                                }}>
                                RS
                            </button>
                        </div>
                    </div>

                    <div style={{ marginBottom: '5px', color: '#aaa', fontSize: '9px', textAlign: 'center' }}>
                        ADJUSTING: {controlTarget === 'camera' ? "DEPTH CAMERA" : "REALSENSE MODEL"}
                    </div>

                    {controlTarget === 'camera' ? (
                        <>
                            <div style={{ marginBottom: '5px' }}>Pos X: {camOffset.x.toFixed(2)}</div>
                            <input type="range" min="-2" max="2" step="0.01" value={camOffset.x} onChange={(e) => setCamOffset({ ...camOffset, x: parseFloat(e.target.value) })} style={{ width: '100%' }} />

                            <div style={{ marginBottom: '5px' }}>Pos Y: {camOffset.y.toFixed(2)}</div>
                            <input type="range" min="-2" max="2" step="0.01" value={camOffset.y} onChange={(e) => setCamOffset({ ...camOffset, y: parseFloat(e.target.value) })} style={{ width: '100%' }} />

                            <div style={{ marginBottom: '5px' }}>Pos Z: {camOffset.z.toFixed(2)}</div>
                            <input type="range" min="-2" max="2" step="0.01" value={camOffset.z} onChange={(e) => setCamOffset({ ...camOffset, z: parseFloat(e.target.value) })} style={{ width: '100%' }} />

                            <div style={{ borderTop: '1px solid #444', margin: '5px 0' }}></div>

                            <div style={{ marginBottom: '5px' }}>Rot X: {camRot.x}°</div>
                            <input type="range" min="-180" max="180" step="1" value={camRot.x} onChange={(e) => setCamRot({ ...camRot, x: parseFloat(e.target.value) })} style={{ width: '100%' }} />

                            <div style={{ marginBottom: '5px' }}>Rot Y: {camRot.y}°</div>
                            <input type="range" min="-180" max="180" step="1" value={camRot.y} onChange={(e) => setCamRot({ ...camRot, y: parseFloat(e.target.value) })} style={{ width: '100%' }} />

                            <div style={{ marginBottom: '5px' }}>Rot Z: {camRot.z}°</div>
                            <input type="range" min="-180" max="180" step="1" value={camRot.z} onChange={(e) => setCamRot({ ...camRot, z: parseFloat(e.target.value) })} style={{ width: '100%' }} />
                        </>
                    ) : (
                        <>
                            <div style={{ marginBottom: '5px' }}>RS Pos X: {rsOffset.x.toFixed(2)}</div>
                            <input type="range" min="-2" max="2" step="0.01" value={rsOffset.x} onChange={(e) => setRsOffset({ ...rsOffset, x: parseFloat(e.target.value) })} style={{ width: '100%' }} />

                            <div style={{ marginBottom: '5px' }}>RS Pos Y: {rsOffset.y.toFixed(2)}</div>
                            <input type="range" min="-2" max="2" step="0.01" value={rsOffset.y} onChange={(e) => setRsOffset({ ...rsOffset, y: parseFloat(e.target.value) })} style={{ width: '100%' }} />

                            <div style={{ marginBottom: '5px' }}>RS Pos Z: {rsOffset.z.toFixed(2)}</div>
                            <input type="range" min="-2" max="2" step="0.01" value={rsOffset.z} onChange={(e) => setRsOffset({ ...rsOffset, z: parseFloat(e.target.value) })} style={{ width: '100%' }} />

                            <div style={{ borderTop: '1px solid #444', margin: '5px 0' }}></div>

                            <div style={{ marginBottom: '5px' }}>RS Rot X: {rsRot.x}°</div>
                            <input type="range" min="-180" max="180" step="1" value={rsRot.x} onChange={(e) => setRsRot({ ...rsRot, x: parseFloat(e.target.value) })} style={{ width: '100%' }} />

                            <div style={{ marginBottom: '5px' }}>RS Rot Y: {rsRot.y}°</div>
                            <input type="range" min="-180" max="180" step="1" value={rsRot.y} onChange={(e) => setRsRot({ ...rsRot, y: parseFloat(e.target.value) })} style={{ width: '100%' }} />

                            <div style={{ marginBottom: '5px' }}>RS Rot Z: {rsRot.z}°</div>
                            <input type="range" min="-180" max="180" step="1" value={rsRot.z} onChange={(e) => setRsRot({ ...rsRot, z: parseFloat(e.target.value) })} style={{ width: '100%' }} />
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default App;