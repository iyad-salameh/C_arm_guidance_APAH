import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { projectPointToLineParamsInto } from './utils/imagingGeometry.js';

// --- CONFIGURATION ---
const PATIENT_URL = 'https://raw.githubusercontent.com/iyad-salameh/C_arm_guidance_APAH/main/assets/patient.glb?v=3';
const CARM_URL = 'https://raw.githubusercontent.com/iyad-salameh/C_arm_guidance_APAH/main/assets/c-armModel.glb?v=1';
const realsense_URL = 'https://raw.githubusercontent.com/iyad-salameh/C_arm_guidance_APAH/main/assets/realsense.glb?v=1';
const ISO_WORLD = new THREE.Vector3(0, 1.45, 0);

// --- MATH UTILS & DEVICE PROFILE ---
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

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

// --- ROBUST ZONE CLASSIFIER HELPERS ---

// --- ROBUST ZONE CLASSIFIER HELPERS (SKELETON-BASED) ---

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// 1. SKELETON DEFINITION (Canonical UVW: U=Height, V=Width, W=Depth)
// Coordinate Format: new THREE.Vector3(V, U, W) -> (Lat, Long, Depth) matching standard T-pose 0..1 bounding box
const SKELETON_NODES_UVW = {
    // U=Height (0=Feet, 1=Head), V=Width (0.5=Center), W=Depth (0.5=Center)
    "0_lowerSpine": new THREE.Vector3(0.50, 0.44, 0.50),
    "1_rightHip": new THREE.Vector3(0.55, 0.42, 0.50),
    "2_rightKnee": new THREE.Vector3(0.54, 0.22, 0.50),
    "3_rightFoot": new THREE.Vector3(0.53, 0.05, 0.50),
    "4_leftHip": new THREE.Vector3(0.45, 0.42, 0.50),
    "5_leftKnee": new THREE.Vector3(0.46, 0.22, 0.50),
    "6_leftFoot": new THREE.Vector3(0.47, 0.05, 0.50),
    "7_midSpine": new THREE.Vector3(0.50, 0.62, 0.50),
    "8_upperSpine": new THREE.Vector3(0.50, 0.76, 0.50),
    "9_neck": new THREE.Vector3(0.50, 0.86, 0.50),
    "10_head": new THREE.Vector3(0.50, 0.95, 0.50),
    "11_leftShoulder": new THREE.Vector3(0.36, 0.76, 0.50),
    "12_leftElbow": new THREE.Vector3(0.32, 0.60, 0.50),
    "13_leftHand": new THREE.Vector3(0.30, 0.46, 0.50),
    "14_rightShoulder": new THREE.Vector3(0.64, 0.76, 0.50),
    "15_rightElbow": new THREE.Vector3(0.68, 0.60, 0.50),
    "16_rightHand": new THREE.Vector3(0.70, 0.46, 0.50)
};

const SKELETON_EDGES = [
    { name: "spine_lower", a: "0_lowerSpine", b: "7_midSpine", zone: "abdomen" },
    { name: "spine_mid", a: "7_midSpine", b: "8_upperSpine", zone: "thorax" },
    { name: "spine_upper", a: "8_upperSpine", b: "9_neck", zone: "thorax" },
    { name: "neck_head", a: "9_neck", b: "10_head", zone: "head" },
    { name: "hip_right", a: "0_lowerSpine", b: "1_rightHip", zone: "pelvis" },
    { name: "hip_left", a: "0_lowerSpine", b: "4_leftHip", zone: "pelvis" },
    { name: "femur_right", a: "1_rightHip", b: "2_rightKnee", zone: "femur" },
    { name: "femur_left", a: "4_leftHip", b: "5_leftKnee", zone: "femur" },
    {
        name: "lowerleg_right", a: "2_rightKnee", b: "3_rightFoot",
        zone_by_t: { 0.15: "knee", 0.85: "tibia", 1.0: "foot" }
    },
    {
        name: "lowerleg_left", a: "5_leftKnee", b: "6_leftFoot",
        zone_by_t: { 0.15: "knee", 0.85: "tibia", 1.0: "foot" }
    },
    { name: "shoulder_left", a: "8_upperSpine", b: "11_leftShoulder", zone: "shoulder" },
    { name: "shoulder_right", a: "8_upperSpine", b: "14_rightShoulder", zone: "shoulder" },
    { name: "upperarm_left", a: "11_leftShoulder", b: "12_leftElbow", zone: "humerus" },
    { name: "upperarm_right", a: "14_rightShoulder", b: "15_rightElbow", zone: "humerus" },
    {
        name: "forearm_left", a: "12_leftElbow", b: "13_leftHand",
        zone_by_t: { 0.75: "forearm", 1.0: "hand" }
    },
    {
        name: "forearm_right", a: "15_rightElbow", b: "16_rightHand",
        zone_by_t: { 0.75: "forearm", 1.0: "hand" }
    }
];

const JOINT_SNAP_RULES = [
    { node: "2_rightKnee", zoneKey: "knee" },
    { node: "5_leftKnee", zoneKey: "knee" },
    { node: "10_head", zoneKey: "head" },
    { node: "13_leftHand", zoneKey: "hand" },
    { node: "16_rightHand", zoneKey: "hand" }
];
const SNAP_RADIUS_SQ = 0.055 * 0.055;

// 2. MATH HELPERS
const getBodyAxes = (bounds) => {
    const s = {
        x: bounds.maxX - bounds.minX,
        y: bounds.maxY - bounds.minY,
        z: bounds.maxZ - bounds.minZ
    };
    // Largest span = U (Long)
    // 2nd Largest = V (Lat)
    // Smallest = W (Depth)
    const axes = Object.keys(s).sort((a, b) => s[b] - s[a]);
    return { u: axes[0], v: axes[1], w: axes[2] };
};

const localToUVW = (local, bounds, axes) => {
    const getNorm = (axis) => {
        const minVal = bounds['min' + axis.toUpperCase()];
        const maxVal = bounds['max' + axis.toUpperCase()];
        if (Math.abs(maxVal - minVal) < 1e-6) return 0.5;
        return (local[axis] - minVal) / (maxVal - minVal);
    };

    // Map to Canonical Vector3(V, U, W) = (Width, Height, Depth)
    return new THREE.Vector3(
        getNorm(axes.v), // X = V (Width)
        getNorm(axes.u), // Y = U (Height)
        getNorm(axes.w)  // Z = W (Depth)
    );
};

const dist2PointToSegmentUVW = (P, A, B) => {
    const pax = P.x - A.x, pay = P.y - A.y, paz = P.z - A.z;
    const bax = B.x - A.x, bay = B.y - A.y, baz = B.z - A.z;
    const lenSq = bax * bax + bay * bay + baz * baz;
    const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (lenSq + 1e-8)));
    const dx = pax - bax * h;
    const dy = pay - bay * h;
    const dz = paz - baz * h;
    return { d2: dx * dx + dy * dy + dz * dz, t: h };
};

const dist2PointToNode = (P, N) => {
    const dx = P.x - N.x, dy = P.y - N.y, dz = P.z - N.z;
    return dx * dx + dy * dy + dz * dz;
};

// 3. MAIN CLASSIFIER
const classifyUVWPointBySkeleton = (pUVW) => {
    let bestDistSq = Infinity;
    let bestZone = ZONE_DEFS.miss;
    let bestEdgeName = null;

    // Check Joint Snapping First (Optimization)
    for (const rule of JOINT_SNAP_RULES) {
        const N = SKELETON_NODES_UVW[rule.node];
        const d2 = dist2PointToNode(pUVW, N);
        if (d2 < SNAP_RADIUS_SQ) {
            // If inside snap radius, we can just take it, but we need to compare against others?
            // "if a sample is closest to a knee node... output knee"
            // We treat this as a high-priority "edge" of length 0.
            if (d2 < bestDistSq) {
                bestDistSq = d2;
                bestZone = ZONE_DEFS[rule.zoneKey];
                bestEdgeName = `SNAP:${rule.node}`;
            }
        }
    }

    // If snapped, we might still check edges to see if we are CLOSER to an edge center than the node?
    // But usually snapping is dominant.
    // Let's iterate edges too, to be safe.

    // Check edges
    for (const edge of SKELETON_EDGES) {
        const A = SKELETON_NODES_UVW[edge.a];
        const B = SKELETON_NODES_UVW[edge.b];
        const { d2, t } = dist2PointToSegmentUVW(pUVW, A, B);

        if (d2 < bestDistSq) {
            bestDistSq = d2;
            bestEdgeName = edge.name;

            // Resolve Zone
            if (edge.zone) {
                bestZone = ZONE_DEFS[edge.zone];
            } else if (edge.zone_by_t) {
                bestZone = ZONE_DEFS.miss; // fallback
                const thresholds = Object.keys(edge.zone_by_t).sort((a, b) => parseFloat(a) - parseFloat(b));
                for (const th of thresholds) {
                    if (t < parseFloat(th)) {
                        bestZone = ZONE_DEFS[edge.zone_by_t[th]];
                        break;
                    }
                }
                if (bestZone === ZONE_DEFS.miss && edge.zone_by_t['1.0']) {
                    bestZone = ZONE_DEFS[edge.zone_by_t['1.0']];
                }
            }
        }
    }

    return { zone: bestZone, d2: bestDistSq, bestEdgeName };
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
        lift: -0.3,
        column_rot: 0,
        wig_wag: 0,
        orbital_slide: 0,
        cart_x: 1.7, // Longitudinal
        cart_z: 0.0, // Lateral (New)
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
            if (e.key.toLowerCase() === 'd') {
                setDebugEnabled(prev => {
                    const next = !prev;
                    debugEnabledRef.current = next;
                    return next;
                });
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

        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
        camera.position.set(3.5, 2.5, 3.5);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(width, height);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        while (mountRef.current.firstChild) mountRef.current.removeChild(mountRef.current.firstChild);
        mountRef.current.appendChild(renderer.domElement);

        const orbit = new OrbitControls(camera, renderer.domElement);
        orbit.enableDamping = true;
        orbit.target.set(0, 1.2, 0);

        const ambient = new THREE.AmbientLight(0xffffff, 0.7);
        scene.add(ambient);
        const sun = new THREE.DirectionalLight(0xffffff, 1.2);
        sun.position.set(5, 10, 5);
        sun.castShadow = true;
        sun.shadow.mapSize.width = 2048;
        sun.shadow.mapSize.height = 2048;
        scene.add(sun);

        // --- ENVIRONMENT ---
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0xe0e6eb, roughness: 0.6 }));
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);

        const wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 15), new THREE.MeshStandardMaterial({ color: 0xf5f7fa }));
        wall.position.set(0, 7.5, -6);
        wall.receiveShadow = true;
        scene.add(wall);

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

        // 4. SKELETON DEBUG (New)
        const skelGroup = new THREE.Group();
        skelGroup.visible = false;
        scene.add(skelGroup);
        skeletonDebugRef.current = skelGroup;

        // Create meshes for nodes
        Object.keys(SKELETON_NODES_UVW).forEach(key => {
            const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), new THREE.MeshBasicMaterial({ color: 0x00ffff, depthTest: false }));
            mesh.renderOrder = 999;
            mesh.name = key;
            skelGroup.add(mesh);
        });

        // Create lines for edges
        SKELETON_EDGES.forEach(edge => {
            const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
            const mat = new THREE.LineBasicMaterial({ color: 0x00aaaa, transparent: true, opacity: 0.5, depthTest: false });
            const line = new THREE.Line(geo, mat);
            line.renderOrder = 998;
            line.name = edge.name;
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

        // --- LOAD MODELS (Promise-based) ---
        const loader = new GLTFLoader();
        const loadModel = (url) => new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));

        Promise.all([
            loadModel(PATIENT_URL),
            loadModel(CARM_URL),
            loadModel(realsense_URL)
        ]).then(([patientGltf, carmGltf, rsGltf]) => {
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
            rsModel.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
            rsModel.position.set(-0.22, 2.16, 0.0);
            rsModel.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
            bedGroup.add(rsModel);

            setModelLoading(false);
        }).catch(err => {
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
            orbit.update();

            // PHYSICS LOOP
            if (srcAnchorRef.current && detAnchorRef.current && beamRef.current) {
                srcAnchorRef.current.getWorldPosition(v1);
                detAnchorRef.current.getWorldPosition(v2);
                const distance = v1.distanceTo(v2);

                // Beam Logic (World Space Alignment)
                // v1 = SRC, v2 = DET
                dir.subVectors(v2, v1);
                const sid = dir.length();
                dir.normalize(); // Now dir is unit vector SRC->DET

                beamRef.current.visible = beamActiveRef.current;

                // Position at SRC
                beamRef.current.position.copy(v1);

                // Orient Y-axis cone to point along dir
                beamRef.current.quaternion.setFromUnitVectors(yAxis, dir);

                // Scale Z to match distance (Y is length axis for our cone, X/Z are thickness)
                // Use const beamRadius ~ 0.2
                beamRef.current.scale.set(0.2, sid, 0.2);


                // --- DEBUG UPDATE ---
                if (debugEnabledRef.current) {
                    if (isoMarker) isoMarker.visible = true;

                    // Update Visuals every frame for smoothness
                    rayLine.visible = true;
                    closestPtMarker.visible = true;
                    connLine.visible = true;

                    // Update Ray Line (Red) - Finite Segment SRC->DET
                    const positions = rayLine.geometry.attributes.position.array;
                    v1.toArray(positions, 0); // Start
                    v2.toArray(positions, 3); // End
                    rayLine.geometry.attributes.position.needsUpdate = true;

                    // Calc Geometry (Allocation-Free)
                    // 1. Project to Infinite Line (computes vSeg=AB, vecToI=AP)
                    // Returns UNCLAMPED t
                    const t = projectPointToLineParamsInto(ISO_WORLD, v1, v2, tempVec, vSeg, vecToI);

                    // 2. Clamp t to [0, 1] for Segment
                    const tClamped = Math.max(0, Math.min(1, t));

                    // 3. Compute Clamped Closest Point on Segment
                    closestPoint.copy(v1).addScaledVector(vSeg, tClamped);

                    // Update Closest Point Marker (Yellow) - CLAMPED
                    closestPtMarker.position.copy(closestPoint);

                    // Update Connector Line (Green) - CLAMPED
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
                    let normY = 0;

                    if (patientModelRef.current && bounds.ready) {
                        // --- OBB-STYLE INTERSECTION (Patient Local Space) ---
                        // 1. Transform Beam Endpoints to Patient Local Space
                        // Force update to ensure world matrix is fresh
                        patientModelRef.current.updateMatrixWorld(true);

                        localV1.copy(v1); // SRC
                        patientModelRef.current.worldToLocal(localV1);

                        localV2.copy(v2); // DET
                        patientModelRef.current.worldToLocal(localV2);

                        // 2. Build Local Ray
                        localDir.subVectors(localV2, localV1);
                        const localSid = localDir.length();
                        localDir.normalize();

                        rayLocal.set(localV1, localDir);

                        // 3. Intersect against Patient Local AABB (which is OBB in world)
                        localBox.min.set(bounds.minX, bounds.minY, bounds.minZ);
                        localBox.max.set(bounds.maxX, bounds.maxY, bounds.maxZ);

                        const hitEntry = rayLocal.intersectBox(localBox, entryLocal);

                        if (hitEntry) {
                            // Check if entry is within local SID
                            const distEntry = entryLocal.distanceTo(localV1);

                            if (distEntry <= localSid) {
                                isHitting = true;

                                // Compute Exit Point
                                // Reverse ray from V2
                                // reusing 'tempVec' for reverse dir
                                tempVec.copy(localDir).multiplyScalar(-1);
                                rayLocal.set(localV2, tempVec);
                                const hitExit = rayLocal.intersectBox(localBox, exitLocal);

                                if (!hitExit) {
                                    exitLocal.copy(entryLocal); // Fallback
                                }

                                // Compute tEntry and tExit (normalized 0..1 along beam)
                                const distExitFromDet = exitLocal.distanceTo(localV2);

                                const tEntry = distEntry / localSid;
                                const tExit = 1.0 - (distExitFromDet / localSid);

                                // Ensure valid range
                                const tStart = Math.max(0, tEntry);
                                const tEnd = Math.min(1, tExit);

                                if (tEnd > tStart) {
                                    // --- MULTI-POINT SAMPLING & VOTING (SKELETON) ---
                                    const SAMPLES = 9;
                                    const counts = Object.create(null);
                                    let bestSampleEdge = "";
                                    let bestSampleD2 = Infinity;

                                    const bodyAxes = getBodyAxes(bounds);

                                    for (let i = 0; i < SAMPLES; i++) {
                                        // Inclusive sampling
                                        const t = (SAMPLES > 1) ? (tStart + (tEnd - tStart) * (i / (SAMPLES - 1))) : (tStart + tEnd) * 0.5;
                                        sampleLocal.copy(localDir).multiplyScalar(t * localSid).add(localV1);

                                        // Convert to UVW
                                        const pUVW = localToUVW(sampleLocal, bounds, bodyAxes);

                                        // Classify
                                        const res = classifyUVWPointBySkeleton(pUVW);

                                        // Voting Weight = 1 / (d2 + 1e-4)
                                        const weight = 1.0 / (res.d2 + 1e-4);
                                        counts[res.zone.key] = (counts[res.zone.key] || 0) + weight;

                                        // Debug info (track closest sample)
                                        if (res.d2 < bestSampleD2) {
                                            bestSampleD2 = res.d2;
                                            bestSampleEdge = res.bestEdgeName;
                                            // Optional: Use normY for debug display if expected a number, but we store string
                                            // beamNormYRef expects ? 
                                            // existing code used it for number. We can store string.
                                        }
                                    }

                                    // Pick Winner (Max Weight)
                                    let bestKey = 'miss';
                                    let bestWeight = -1;
                                    for (const key in counts) {
                                        if (counts[key] > bestWeight) {
                                            bestWeight = counts[key];
                                            bestKey = key;
                                        }
                                    }
                                    zoneResult = ZONE_DEFS[bestKey] || ZONE_DEFS.miss;

                                    // Debug Text Update
                                    beamNormYRef.current = `${bestSampleEdge} d:${Math.sqrt(bestSampleD2).toFixed(3)}`;
                                }
                            }
                        }
                    }

                    // Update Refs & UI (Throttled)
                    beamZoneKeyRef.current = zoneResult.key;
                    beamRegionRef.current = zoneResult.label;
                    beamHitRef.current = isHitting;
                    if (!isHitting) beamNormYRef.current = null;

                    setBeamRegionUI(zoneResult.label);
                    setBeamZoneKeyUI(zoneResult.key);

                    // --- UPDATE SKELETON DEBUG VISUALS ---
                    if (skeletonDebugRef.current) {
                        skeletonDebugRef.current.visible = debugEnabledRef.current;

                        if (debugEnabledRef.current && patientModelRef.current && bounds.ready) {
                            const bodyAxes = getBodyAxes(bounds);

                            // Transform Helper: Canonical UVW -> World
                            // Reuses localV1 and localV2 as scratch since they are recomputed next tick
                            const uvwToWorld = (uvw, target) => {
                                const local = target;
                                // Map UVW (X=Lat, Y=Long, Z=Depth) to Local
                                // local[axis] = uvw[normAxis] * span + min
                                const setAxis = (axis, val) => {
                                    local[axis] = val * (bounds['max' + axis.toUpperCase()] - bounds['min' + axis.toUpperCase()]) + bounds['min' + axis.toUpperCase()];
                                };
                                setAxis(bodyAxes.v, uvw.x); // V = Width
                                setAxis(bodyAxes.u, uvw.y); // U = Height
                                setAxis(bodyAxes.w, uvw.z); // W = Depth

                                local.applyMatrix4(patientModelRef.current.matrixWorld);
                                return local;
                            };

                            // Update Nodes
                            skeletonDebugRef.current.children.forEach(child => {
                                if (SKELETON_NODES_UVW[child.name]) {
                                    const uvw = SKELETON_NODES_UVW[child.name];
                                    uvwToWorld(uvw, child.position);
                                } else if (child.type === 'Line') {
                                    // Update Edges
                                    const edge = SKELETON_EDGES.find(e => e.name === child.name);
                                    if (edge) {
                                        const pos = child.geometry.attributes.position.array;
                                        const start = localV1;
                                        const end = localV2;

                                        uvwToWorld(SKELETON_NODES_UVW[edge.a], start);
                                        uvwToWorld(SKELETON_NODES_UVW[edge.b], end);

                                        start.toArray(pos, 0);
                                        end.toArray(pos, 3);
                                        child.geometry.attributes.position.needsUpdate = true;
                                    }
                                }
                            });
                        }
                    } // end debug update


                    // --- 2. DEBUG READOUT (Optional) ---
                    if (debugEnabledRef.current) {
                        // Re-calc geometry primitives for readout logic if needed, 
                        // or just rely on standard ones. 
                        // Note: primitives (v1, v2) are fresh. But 't', 'closestPoint' were 
                        // computed inside the visual block above. 
                        // Safest to re-compute specific metrics needed for text.

                        // IsoRay: Distance to INFINITE line (via tempVec)
                        projectPointToLineParamsInto(ISO_WORLD, v1, v2, tempVec, vSeg, vecToI);
                        const isoRayDist = ISO_WORLD.distanceTo(tempVec);

                        // IsoSeg: Distance to FINITE segment (via closestPoint)
                        const t = projectPointToLineParamsInto(ISO_WORLD, v1, v2, tempVec, vSeg, vecToI);
                        const tClamped = Math.max(0, Math.min(1, t));
                        closestPoint.copy(v1).addScaledVector(vSeg, tClamped);
                        const isoSegDist = ISO_WORLD.distanceTo(closestPoint);

                        // MidToIso: Midpoint of Segment
                        tempVec.addVectors(v1, v2).multiplyScalar(0.5);
                        const midToIso = tempVec.distanceTo(ISO_WORLD);

                        // Beam Angle Check (Alignment Debug)
                        beamRef.current.updateMatrixWorld();
                        beamAxisWorld.copy(yAxis).applyQuaternion(beamRef.current.quaternion);
                        const angleDeg = beamAxisWorld.angleTo(dir) * 180 / Math.PI;

                        // Beam Base Error Check
                        tempVec.set(0, 1, 0).applyMatrix4(beamRef.current.matrixWorld);
                        const beamBaseErr = tempVec.distanceTo(v2);

                        const newReadout = {
                            src: v1.toArray().map(n => n.toFixed(3)),
                            det: v2.toArray().map(n => n.toFixed(3)),
                            sid: distance.toFixed(3),
                            midToIso: midToIso.toFixed(3),
                            isoRay: isoRayDist.toFixed(3),
                            isoSeg: isoSegDist.toFixed(3),
                            t: t.toFixed(3), // Show UNCLAMPED t
                            beamAngle: angleDeg.toFixed(3),
                            beamErr: beamBaseErr.toFixed(3),
                            beamRegion: zoneResult.label,
                            hitStatus: isHitting ? "HIT" : "MISS",
                            normY: beamNormYRef.current || "NA"
                        };
                        setDebugReadout(newReadout);
                    }


                } // End 10Hz

            } // End srcAnchorRef check

            renderer.render(scene, camera);
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
            cancelAnimationFrame(reqId);
            window.removeEventListener('resize', handleResize);
            if (mountRef.current) mountRef.current.innerHTML = '';

            renderer.dispose();
            orbit.dispose();

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

    const containerStyle = { position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: '#eef2f5', fontFamily: 'sans-serif', color: '#333' };
    const xrayStyle = { position: 'absolute', top: '20px', left: '20px', width: '200px', height: '220px', backgroundColor: '#000', borderRadius: '8px', border: '2px solid #333', display: 'flex', flexDirection: 'column', overflow: 'hidden', pointerEvents: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.3)', color: '#fff' };
    const controlsStyle = { position: 'absolute', top: '260px', left: '20px', width: '280px', backgroundColor: 'rgba(255,255,255,0.95)', padding: '20px', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.1)', pointerEvents: 'auto' };

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
            </div>

            <div style={controlsStyle}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '15px' }}>
                    <div style={{ width: '30px', height: '30px', background: '#ff6600', borderRadius: '6px', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', marginRight: '10px' }}>C</div>
                    <div><h3 style={{ margin: 0, fontSize: '14px' }}>CIARTIC Move</h3><span style={{ fontSize: '10px', color: '#888' }}>ROBOTIC SYSTEM</span></div>
                </div>
                {modelLoading && <div style={{ fontSize: '10px', color: '#888', marginBottom: '10px' }}>Loading Patient Model...</div>}
                {Object.entries(CONTROL_SPECS).map(([key, spec]) => {
                    const val = controls[key];
                    const displayVal = spec.type === 'rotate'
                        ? (val * R2D).toFixed(1) + '°'
                        : val.toFixed(2) + 'm';

                    return (
                        <div key={key} style={{ marginBottom: '12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase', color: '#666' }}>
                                {spec.label}
                                <span style={{ color: '#ff6600' }}>{displayVal}</span>
                            </div>
                            <input type="range"
                                min={spec.min}
                                max={spec.max}
                                step={spec.step}
                                value={val}
                                disabled={beamActive}
                                onChange={e => !beamActive && setControls({ ...controls, [key]: parseFloat(e.target.value) })}
                                style={{ width: '100%', cursor: beamActive ? 'not-allowed' : 'pointer', opacity: beamActive ? 0.5 : 1 }} />
                        </div>
                    );
                })}
                <div style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '15px' }}>
                    <button onClick={handleTakeXray} disabled={beamActive} style={{ width: '100%', padding: '12px', backgroundColor: beamActive ? '#ff0000' : '#333', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: beamActive ? 'not-allowed' : 'pointer', transition: 'background 0.2s' }}>
                        {beamActive ? 'EXPOSING...' : 'TAKE X-RAY'}
                    </button>
                    <button
                        onClick={handleDownloadXray}
                        disabled={!lastXray || beamActive}
                        style={{
                            width: '100%',
                            marginTop: '10px',
                            padding: '10px',
                            backgroundColor: (!lastXray || beamActive) ? '#ddd' : '#444',
                            color: (!lastXray || beamActive) ? '#999' : 'white',
                            border: 'none',
                            borderRadius: '8px',
                            fontWeight: 'bold',
                            cursor: (!lastXray || beamActive) ? 'not-allowed' : 'pointer',
                            transition: 'all 0.2s'
                        }}>
                        DOWNLOAD X-RAY
                    </button>
                </div>
            </div>

            <style>{`
          @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.2; } 100% { opacity: 1; } }
      `}</style>
        </div>
    );
};

export default App;