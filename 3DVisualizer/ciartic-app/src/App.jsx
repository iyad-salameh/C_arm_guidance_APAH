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
    left_shoulder: { key: 'left_shoulder', label: 'LEFT SHOULDER' },
    right_shoulder: { key: 'right_shoulder', label: 'RIGHT SHOULDER' },
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
    if (key.includes("upperSpine") && key.includes("Shoulder")) {
        if (key.includes("left")) return ZONE_DEFS.left_shoulder;
        if (key.includes("right")) return ZONE_DEFS.right_shoulder;
        return ZONE_DEFS.shoulder;
    }

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

    ////////////Arduino control/////////////////

    // --- SERIAL (ARDUINO) ---
    const serialPortRef = useRef(null);
    const serialWriterRef = useRef(null);
    const lastSentRef = useRef({ w: null, c: null, t: 0 });
    const isArduinoConnectedRef = useRef(false);


    ////////////End of Arduino Control//////////////////

    const beamRegionRef = useRef("WAITING FOR PATIENT..."); // Kept for label string
    const beamZoneKeyRef = useRef('miss'); // NEW: Store key
    const beamHitRef = useRef(false);
    const beamNormYRef = useRef(null);
    const [beamRegionUI, setBeamRegionUI] = useState("WAITING FOR PATIENT...");
    const [beamZoneKeyUI, setBeamZoneKeyUI] = useState('miss'); // For header color

    const patientModelRef = useRef(null);
    const patientBoundsRef = useRef({ ready: false, minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 });


    ////Arduino code for sending functions////

    const radToDeg = (r) => (r * 180) / Math.PI;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    const sendServos = async (wigDeg, colDeg) => {
        if (!serialWriterRef.current) return;

        const msg = `W:${Math.round(wigDeg)} C:${Math.round(colDeg)}\n`;
        const data = new TextEncoder().encode(msg);

        try {
            await serialWriterRef.current.write(data);
        } catch (e) {
            console.warn("Serial write failed", e);
        }
    };
    ////end of arduino part for functions/////


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

    // --- CONTINUOUS SKELETON ATLAS X-RAY ---
    const skeletonAtlasRef = useRef(null);
    const [atlasLoaded, setAtlasLoaded] = useState(false);

    // Preload the single skeleton atlas
    useEffect(() => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => {
            skeletonAtlasRef.current = img;
            setAtlasLoaded(true);
            console.log("Skeleton atlas loaded", img.width, img.height);
        };
        img.onerror = (e) => console.error("Failed to load skeleton atlas", e);
        img.src = '/xrays/skeleton.png';
    }, []);


    // --- DYNAMIC ANATOMY GENERATOR (ATLAS SKELETON) ---
    const generateRealisticXray = (currentControls = controls, zoneKeyOverride = null) => {
        const { cart_x, cart_z, orbital_slide, wig_wag } = currentControls;

        // If atlas isn't ready, fallback to noise
        if (!skeletonAtlasRef.current) {
            return generateNoiseXray("LOADING...");
        }

        const img = skeletonAtlasRef.current;
        const canvas = document.createElement('canvas');
        const size = 512; // Output resolution
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // --- 1. MAPPING PHYSICS TO IMAGE COORDINATES ---
        // Patient Head at cart_x ~ 0.8m, Feet at ~ 2.5m
        // Image Top (Y=0) = Head, Image Bottom (Y=H) = Feet
        // We need to invert cart_x logic: Low X = Head (Top), High X = Feet (Bottom)?
        // No, in our scene:
        // Cart X=0 is near head? Let's check `getAnatomyZone` logic:
        // cart_x < 1.2 is Head. cart_x > 2.3 is Feet.
        // So Low X = Head (Top of Image), High X = Feet (Bottom of Image).

        // Geometry / FOV Calculation
        // Depth Camera (Perspective) is at Detector.
        // Det Y (Base) = 1.70m. Iso Y = 1.45m. Dist = 0.25m.
        // Lift moves Det Y. Dist = 0.25 + lift.
        // FOV = 58 deg.
        const lift = currentControls.lift || 0;
        const distToIso = Math.max(0.1, 0.25 + lift); // Clamp min 10cm
        // Visible height at Iso plane
        const fovMeters = 3.0 * (2 * distToIso * Math.tan(58 / 2 * (Math.PI / 180))); // Zoom out 3x (150% more than 2x)
        const pixelsPerMeter = img.height / 1.7; // Assuming atlas height represents 1.7m (Head to Toe)
        const fovPixels = fovMeters * pixelsPerMeter;

        // --- 2. TRANSFORMS (Simulate C-Arm Movement) ---
        // Mapping: cart_x (Longitudinal) -> Image Y (Spine Axis)
        // cart_z (Lateral) -> Image X (Width Axis)

        // Calibration:
        // cart_x = 0.8 (Head) -> Image Y = 0 (Top)
        // cart_x = 2.5 (Feet) -> Image Y corresponds to 1.7m
        // We center the view at the current cart_x
        const centerY = (cart_x - 0.8) * pixelsPerMeter;

        // Lateral: Z=0 is center. 
        // Image Width center = img.width / 2.
        const centerX = (img.width / 2) - (cart_z * pixelsPerMeter);

        // --- 3. RENDER ON CANVAS ---
        // Fill pure black
        ctx.fillStyle = "#050505";
        ctx.fillRect(0, 0, size, size);

        // Transform for Rotation (Orbital)
        ctx.translate(size / 2, size / 2);

        // Rotation Logic:
        // User requested 90 deg rotation.
        // wig_wag is tilt.
        const rotation = -wig_wag + Math.PI / 2;
        ctx.rotate(rotation);

        // Simulation of Orbital Rotation (Pseudo-3D effect)
        // orbital_slide rotates C-arm around patient.
        // AP -> Lateral.
        // We simulate this by scaling the width of the AP atlas.
        const viewWidthScale = Math.max(0.2, Math.cos(orbital_slide));
        ctx.scale(viewWidthScale, 1.0); // Compress width


        // Draw Image Crop
        // We want source rect centered at (centerX, centerY) with dim (fovPixels, fovPixels)
        const sw = fovPixels / viewWidthScale; // Compensate scale to keep FOV constant
        const sh = fovPixels;
        const sx = centerX - sw / 2;
        const sy = centerY - sh / 2;

        try {
            ctx.drawImage(img, sx, sy, sw, sh, -size / 2, -size / 2, size, size);
        } catch (e) {
            // Out of bounds safety
        }

        // --- 4. OVERLAYS (Label, Noise) ---
        // Reset transform for text
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        // Update UI state for Download Filename
        // Use legacy helper to guess zone label from cart_x
        const anatomyLabel = getAnatomyZone(cart_x).label;
        if (anatomyLabel !== currentAnatomy) {
            setCurrentAnatomy(anatomyLabel);
        }

        // Noise
        // Since we can't efficiently do SVG filters on canvas easily without WebGL or complex logic,
        // let's just draw valid anatomy. The user wants "Skeleton".
        // We can create a lightweight noise pattern if needed, but 'skeleton.png' is usually enough.

        // Metadata
        ctx.font = "12px monospace";
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.fillText(`kVp: 78  mA: 4.2`, 10, 20);

        // Orientation "R"
        ctx.font = "20px sans-serif";
        ctx.fillText("R", size - 30, size - 20);

        return canvas.toDataURL();
    };

    const generateNoiseXray = (msg) => {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, 256, 256);
        ctx.fillStyle = "#333";
        ctx.font = "20px monospace";
        ctx.textAlign = "center";
        ctx.fillText(msg || "NO SIGNAL", 128, 128);
        return canvas.toDataURL();
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

    // --- ARDUINO CONNECTION ---
    const connectArduino = async () => {
        if (!("serial" in navigator)) {
            alert("Use Chrome or Edge (Web Serial required)");
            return false;
        }

        if (isArduinoConnectedRef.current && serialWriterRef.current)
            return true;

        try {
            const port = await navigator.serial.requestPort();  // must be user gesture
            await port.open({ baudRate: 115200 });

            serialPortRef.current = port;
            serialWriterRef.current = port.writable.getWriter();
            isArduinoConnectedRef.current = true;

            console.log("Arduino connected");
            return true;
        } catch (e) {
            console.warn("Connection cancelled or failed:", e);
            return false;
        }
    };

    const ensureArduinoConnected = async () => {
        if (isArduinoConnectedRef.current && serialWriterRef.current)
            return true;

        return await connectArduino();
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

        // ENABLE LAYERS for Camera (0: Default, 1: Landmarks)
        camera.layers.enable(0);
        camera.layers.enable(1);

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

        const floor = new THREE.Mesh(new THREE.PlaneGeometry(15, 10), floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);

        // Walls (15x15 room, 9m height)
        const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.8, side: THREE.DoubleSide });
        const wallHeight = 9;

        // North wall (positive Z)
        const wallNorth = new THREE.Mesh(new THREE.PlaneGeometry(15, wallHeight), wallMaterial);
        wallNorth.position.set(0, wallHeight / 2, 5.0);
        wallNorth.receiveShadow = true;
        scene.add(wallNorth);

        // South wall (negative Z)
        const wallSouth = new THREE.Mesh(new THREE.PlaneGeometry(15, wallHeight), wallMaterial);
        wallSouth.position.set(0, wallHeight / 2, -5.0);
        wallSouth.rotation.y = Math.PI;
        wallSouth.receiveShadow = true;
        scene.add(wallSouth);

        // East wall (positive X)
        const wallEast = new THREE.Mesh(new THREE.PlaneGeometry(10, wallHeight), wallMaterial);
        wallEast.position.set(7.5, wallHeight / 2, 0);
        wallEast.rotation.y = -Math.PI / 2;
        wallEast.receiveShadow = true;
        scene.add(wallEast);

        // West wall (negative X)
        const wallWest = new THREE.Mesh(new THREE.PlaneGeometry(10, wallHeight), wallMaterial);
        wallWest.position.set(-7.5, wallHeight / 2, 0);
        wallWest.rotation.y = Math.PI / 2;
        wallWest.receiveShadow = true;
        scene.add(wallWest);

        // --- X-RAY ROOM DOOR (West Wall) ---
        const doorGroup = new THREE.Group();
        // Position on West Wall (X=-7.5). Shifted slightly inward (X=-7.45) to avoid z-fighting.
        // Center of wall is Z=0. Let's put door at Z=0.
        doorGroup.position.set(-7.45, 0, 0);
        doorGroup.rotation.y = Math.PI / 2; // Face into room
        scene.add(doorGroup);

        // 1. Door Frame (Stainless Steel)
        const frameW = 2.4;
        const frameH = 2.4;
        const frameD = 0.15;
        const frameGeo = new THREE.BoxGeometry(frameW, frameH, frameD);
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4, metalness: 0.6 });
        const frame = new THREE.Mesh(frameGeo, frameMat);
        frame.position.set(0, frameH / 2, 0);
        doorGroup.add(frame);

        // 2. Door Panel (Lead-Lined, Sliding Style)
        // Sliding door usually wider than opening. Let's make it cover the frame opening.
        const doorW = 2.2;
        const doorH = 2.3;
        const doorD = 0.08;
        const doorGeo = new THREE.BoxGeometry(doorW, doorH, doorD);
        const doorMat = new THREE.MeshStandardMaterial({
            color: 0xe0e0e0, // Off-white / Medical Grey
            roughness: 0.7,
            metalness: 0.1
        });
        const door = new THREE.Mesh(doorGeo, doorMat);
        door.position.set(0.1, doorH / 2, 0.06); // Slightly offset Z (in door group space) for sliding look
        doorGroup.add(door);

        // 3. Kickplate (Chrome)
        const kickH = 0.3;
        const kickGeo = new THREE.PlaneGeometry(doorW - 0.1, kickH);
        const kickMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.2, metalness: 0.8 });
        const kick = new THREE.Mesh(kickGeo, kickMat);
        kick.position.set(0.1, kickH / 2 + 0.01, 0.06 + doorD / 2 + 0.001); // On surface of door
        doorGroup.add(kick);

        // 4. Lead Glass Window (Small, Eye Level)
        const winW = 0.3;
        const winH = 0.6;
        const winGeo = new THREE.PlaneGeometry(winW, winH);
        const winMat = new THREE.MeshPhysicalMaterial({
            color: 0x88ccaa, // Lead glass greenish
            metalness: 0.1,
            roughness: 0.1,
            transmission: 0.5, // Semi-transparent
            thickness: 0.05
        });
        const windowMesh = new THREE.Mesh(winGeo, winMat);
        windowMesh.position.set(0.1, 1.6, 0.06 + doorD / 2 + 0.002);
        doorGroup.add(windowMesh);

        // Frame for Window
        const winFrameGeo = new THREE.BoxGeometry(winW + 0.04, winH + 0.04, 0.02);
        const winFrame = new THREE.Mesh(winFrameGeo, frameMat);
        winFrame.position.set(0.1, 1.6, 0.06 + doorD / 2);
        doorGroup.add(winFrame);

        // 5. Handle (Vertical Bar)
        const handleH = 0.6;
        const handleGeo = new THREE.CylinderGeometry(0.02, 0.02, handleH, 8);
        const handle = new THREE.Mesh(handleGeo, kickMat);
        // Place on right side of door (if sliding left)
        handle.position.set(0.8, 1.1, 0.06 + doorD / 2 + 0.04);
        doorGroup.add(handle);

        // 6. Warning Light Box (Above Frame)
        const warnBoxGeo = new THREE.BoxGeometry(0.6, 0.2, 0.1);
        const warnBoxMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
        const warnBox = new THREE.Mesh(warnBoxGeo, warnBoxMat);
        warnBox.position.set(0, frameH + 0.2, 0); // Above frame
        doorGroup.add(warnBox);

        // "X-RAY IN USE" Text/Light Face
        const warnFaceGeo = new THREE.PlaneGeometry(0.5, 0.15);
        const warnFaceMat = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // Red = On/Warning (or darker if off)
        // Let's make it look "off" but visible red, or "on" if beam is active? 
        // For visualizer, maybe constant red is clearer it's an x-ray room.
        const warnFace = new THREE.Mesh(warnFaceGeo, warnFaceMat);
        warnFace.position.set(0, 0, 0.051); // On surface of box
        warnBox.add(warnFace);

        // Wall Decorations - Horizontal Stripes
        const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0xe8eef2, roughness: 0.7 });
        const stripeHeight = 0.15;
        const stripeY = 1.2;

        // Stripe on North wall
        const stripeNorth = new THREE.Mesh(new THREE.PlaneGeometry(15, stripeHeight), stripeMaterial);
        stripeNorth.position.set(0, stripeY, 5.02);
        scene.add(stripeNorth);

        // Stripe on South wall
        const stripeSouth = new THREE.Mesh(new THREE.PlaneGeometry(15, stripeHeight), stripeMaterial);
        stripeSouth.position.set(0, stripeY, -5.02);
        stripeSouth.rotation.y = Math.PI;
        scene.add(stripeSouth);

        // Stripe on East wall
        const stripeEast = new THREE.Mesh(new THREE.PlaneGeometry(10, stripeHeight), stripeMaterial);
        stripeEast.position.set(7.51, stripeY, 0);
        stripeEast.rotation.y = -Math.PI / 2;
        scene.add(stripeEast);

        // Stripe on West wall
        const stripeWest = new THREE.Mesh(new THREE.PlaneGeometry(10, stripeHeight), stripeMaterial);
        stripeWest.position.set(-7.51, stripeY, 0);
        stripeWest.rotation.y = Math.PI / 2;
        scene.add(stripeWest);

        // Medical Signage Placeholders (colored rectangles)
        const signMaterial = new THREE.MeshStandardMaterial({ color: 0x4a90e2, roughness: 0.3 });
        const signWidth = 0.8;
        const signHeight = 0.6;

        // Sign on North wall
        const signNorth = new THREE.Mesh(new THREE.PlaneGeometry(signWidth, signHeight), signMaterial);
        signNorth.position.set(-5, 2.2, 5.02);
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
                logoPlaneOut.position.set(4, 2, 5.04);
                scene.add(logoPlaneOut);

                // Logo facing inward (inside of room)
                const logoPlaneIn = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), logoMaterial.clone());
                logoPlaneIn.position.set(4, 2, 4.98);
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
                moehePlane.position.set(0, 2, 4.98); // Positioned to the left of QSTSS logo
                moehePlane.rotation.y = Math.PI; // Rotate 180 degrees to face inward
                scene.add(moehePlane);
            },
            undefined,
            (error) => {
                console.warn('MOEHE logo texture not found.');
            }
        );

        // Warning Sign on North wall (inside, Left side)
        const textureLoader3 = new THREE.TextureLoader();
        textureLoader3.load(
            '/warningXray.png',
            (texture) => {
                const warnMaterial = new THREE.MeshStandardMaterial({
                    map: texture,
                    transparent: true,
                    roughness: 0.5
                });

                // Sign facing inward
                const warnPlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), warnMaterial);
                warnPlane.position.set(-4.5, 2, 4.98); // Positioned to the far left (Shifted 0.5m West)
                warnPlane.rotation.y = Math.PI; // Face inward
                scene.add(warnPlane);
            },
            undefined,
            (error) => {
                console.warn('Warning sign texture not found.');
            }
        );

        // Favicon above First Aid Box
        const textureLoader4 = new THREE.TextureLoader();
        textureLoader4.load(
            '/favicon.png',
            (texture) => {
                const favMaterial = new THREE.MeshStandardMaterial({
                    map: texture,
                    transparent: true,
                    roughness: 0.5
                });

                // Above First Aid Box (X=2, Y=1.5). Box Top ~1.7.
                // Place at Y=2.3 (Shifted 30cm up from 2.0)
                const favPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), favMaterial);
                favPlane.position.set(2, 2.3, 4.98);
                favPlane.rotation.y = Math.PI; // Face inward
                scene.add(favPlane);
            },
            undefined,
            (error) => {
                console.warn('Favicon texture not found.');
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
            sphere.layers.set(1); // Layer 1: Landmarks
            skelGroup.add(sphere);
        });

        // Create lines for edges
        EDGES.forEach(edge => {
            const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
            const mat = new THREE.LineBasicMaterial({ color: 0x00aaaa, transparent: true, opacity: 0.5, depthTest: false });
            const line = new THREE.Line(geo, mat);
            line.renderOrder = 998;
            line.name = edge.join('-'); // Use a unique name for the edge line
            line.layers.set(1); // Layer 1: Landmarks
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

        // --- CEILING ---
        // Room is 15m (Z-axis, North-South) x 10m (X-axis, East-West)? Wait, let's check walls.
        // North/South walls are 15m wide (X-axis). East/West walls are 10m wide (Z-axis).
        // Ceiling should match floor: 15x10.
        const ceilingGroup = new THREE.Group();
        ceilingGroup.position.set(0, wallHeight, 0); // Cap the room
        scene.add(ceilingGroup);

        // Main Ceiling Plane
        const ceilingMaterial = new THREE.MeshStandardMaterial({
            color: 0xfdfbf7, // Off-white/Cream
            roughness: 0.9,
            side: THREE.DoubleSide
        });
        const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(15, 10), ceilingMaterial);
        ceiling.rotation.x = Math.PI / 2; // Face down
        ceiling.receiveShadow = true;
        ceilingGroup.add(ceiling);

        // Ceiling Tiles / Grid Texture (Procedural via Canvas?) or just simple geometry
        // Let's add some "light panels" - Emissive rectangles
        const lightPanelGeo = new THREE.PlaneGeometry(1.2, 0.6);
        const lightPanelMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: 0xffffee,
            emissiveIntensity: 0.8,
            roughness: 0.2
        });

        // Add 2 rows of lights
        for (let x = -6; x <= 6; x += 3) {
            for (let z = -3.5; z <= 3.5; z += 3.5) {
                const panel = new THREE.Mesh(lightPanelGeo, lightPanelMat);
                panel.rotation.x = Math.PI / 2;
                panel.position.set(x, -0.01, z); // Slightly below ceiling
                ceilingGroup.add(panel);

                // Add a local point light for each panel to make it realistic? 
                // Too expensive for 10+ lights. Stick to the main directional light + ambient.
            }
        }

        // --- LOAD MODELS (Promise-based) ---
        const loader = new GLTFLoader();
        // Register extension if available (it's not in v0.182, but good practice to check/try)
        // Since we removed it from extensionsRequired, it should load with fallback materials.

        const loadModel = (url) => new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));

        Promise.allSettled([
            loadModel(PATIENT_URL),
            loadModel(CARM_URL),
            loadModel(realsense_URL),
            loadModel('/fire_extinguisher/scene.gltf'),
            loadModel('/first_aid_box/scene.gltf'),
            loadModel('/female_human_skeleton_-_zbrush_-_anatomy_study/scene.gltf')
        ]).then((results) => {
            if (!mounted) return;

            // Helper to get result or null
            const getModel = (index) => results[index].status === 'fulfilled' ? results[index].value : null;

            // 1. Patient
            const patientGltf = getModel(0);
            if (patientGltf) {
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
            } else {
                console.warn("Patient model failed to load:", results[0].reason);
            }

            // 2. Extra C-Arm
            const carmGltf = getModel(1);
            if (carmGltf) {
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
            }

            // 3. Realsense
            const rsGltf = getModel(2);
            if (rsGltf) {
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
            }

            // 4. Fire Extinguisher
            const fireGltf = getModel(3);
            if (fireGltf) {
                const fireModel = fireGltf.scene;
                const fireBox = new THREE.Box3().setFromObject(fireModel);
                const fireSize = new THREE.Vector3();
                fireBox.getSize(fireSize);
                const maxDimF = Math.max(fireSize.x, fireSize.y, fireSize.z);
                if (maxDimF > 0) {
                    const scale = 0.5 / maxDimF; // 50cm tall approx
                    fireModel.scale.set(scale, scale, scale);
                }
                // Reposition below First Aid Box (X=2, Y=1.5)
                // 0.3m gap below box (Box Bottom ~1.3m). Top of Extinguisher at 1.0m. Center ~0.75m.
                // Let's put it at Y=1.0 for visual balance and "0.3m away" feel
                fireModel.position.set(2, 1.0, 4.95);
                fireModel.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
                scene.add(fireModel);
            }

            // 5. First Aid Box
            const aidGltf = getModel(4);
            if (aidGltf) {
                const aidModel = aidGltf.scene;
                const aidBox = new THREE.Box3().setFromObject(aidModel);
                const aidSize = new THREE.Vector3();
                aidBox.getSize(aidSize);
                const maxDimA = Math.max(aidSize.x, aidSize.y, aidSize.z);
                if (maxDimA > 0) {
                    const scale = 0.4 / maxDimA; // 40cm box
                    aidModel.scale.set(scale, scale, scale);
                }
                // Midpoint between QSTSS (X=4) and MOEHE (X=0) -> X=2
                // Height Y=1.5 (Middle of wall area), Z=10m room
                aidModel.position.set(2, 1.5, 4.95);
                aidModel.rotation.y = Math.PI; // Face room
                aidModel.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
                scene.add(aidModel);
            }

            // 6. Female Skeleton
            const femSkelGltf = getModel(5);
            if (femSkelGltf) {
                const skelModel = femSkelGltf.scene;
                const skelBox = new THREE.Box3().setFromObject(skelModel);
                const skelSize = new THREE.Vector3();
                skelBox.getSize(skelSize);
                const maxDimS = skelSize.y; // Height is main dimension
                if (maxDimS > 0) {
                    const scale = 1.7 / maxDimS; // 1.7m tall
                    skelModel.scale.set(scale, scale, scale);
                }
                // Midpoint between First Aid (X=2) and MOEHE (X=0) -> X=1
                // Moved Up 1m (Y=1) and Left 3.5m (X = 1 - 3.5 = -2.5)
                skelModel.position.set(-2.5, 1.0, 4.95);
                skelModel.rotation.y = Math.PI; // Face room
                skelModel.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
                scene.add(skelModel);
            } else {
                console.warn("Skeleton model failed to load (likely missing extension support):", results[5].reason);
            }

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

                        // --- UPDATE SKELETON DEBUG VISUALS (Always update for Depth View) ---
                        if (skeletonDebugRef.current) {
                            // Globally visible, filtered by Camera Layers
                            skeletonDebugRef.current.visible = true;

                            if (patientModelRef.current && bounds.ready) {
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

                    // --- RENDER PASS 1: CAPTURE DEPTH (Layer 0 only) ---
                    depthCameraRef.current.layers.set(0); // Physical World
                    renderer.setRenderTarget(depthRenderTargetRef.current);
                    // Clear mainly depth
                    renderer.clear();
                    renderer.render(scene, depthCameraRef.current);
                    renderer.setRenderTarget(null);

                    // --- RENDER PASS 2: VISUALIZE DEPTH TO TEXTURE ---
                    if (depthVizSceneRef.current && depthVizTargetRef.current) {
                        renderer.setRenderTarget(depthVizTargetRef.current);
                        renderer.render(depthVizSceneRef.current, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)); // Use simple camera

                        // --- RENDER PASS 3: OVERLAY LANDMARKS (Layer 1) ---
                        // ALWAYS RENDER IN DEPTH VIEW (User Request)
                        renderer.autoClear = false; // Don't wipe the depth map we just drew

                        // CRITICAL: Temporarily remove scene background so we don't draw the grey void over our depth map
                        const oldBg = scene.background;
                        scene.background = null;

                        depthCameraRef.current.layers.set(1); // Landmarks Layer
                        renderer.render(scene, depthCameraRef.current); // Render landmarks on top

                        // Restore
                        scene.background = oldBg;
                        renderer.autoClear = true;

                        renderer.setRenderTarget(null);
                    }

                    // Restore Camera Layer State
                    depthCameraRef.current.layers.set(0);

                    depthCameraRef.current.updateMatrixWorld(true);

                    // (The follow-up render to depthRenderTargetRef.current in original code was redundant or debug? 
                    // It re-renders scene to depth target. We already did that in Pass 1. 
                    // Keeping it might be for the "readPixels" effect below? 
                    // Actually, the readPixels reads from depthVizTargetRef.current.
                    // So we don't need to re-render to depthRenderTargetRef.current unless that target is used elsewhere.)
                    // The original code re-rendered to depthRenderTargetRef.current here. I'll leave it but ensure layer 0.

                    /* 
                    // Original block re-render:
                    renderer.setRenderTarget(depthRenderTargetRef.current);
                    renderer.render(scene, depthCameraRef.current);
                    renderer.setRenderTarget(null); 
                    */
                    // Removing redundant re-render as we did Pass 1.

                    // Update debug helper
                    // Update debug helper
                    if (depthCameraHelperRef.current) {
                        depthCameraHelperRef.current.visible = debugEnabledRef.current;
                        if (debugEnabledRef.current) {
                            depthCameraHelperRef.current.update();
                        }
                    }
                }



                if (showLandmarksRef.current) {
                    camera.layers.enable(1);
                } else {
                    camera.layers.disable(1);
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

    //Arduino useEffect for servo updates//

    useEffect(() => {
        const interval = setInterval(() => {

            const wRad = controlsRef.current.wig_wag;
            const cRad = controlsRef.current.column_rot;

            const wDeg = radToDeg(wRad);
            const cDeg = radToDeg(cRad);

            // Map simulator ranges to servo movement
            const wServo = clamp(90 + (wDeg / 23) * 45, 0, 180);
            const cServo = clamp(90 + (cDeg / 86) * 70, 0, 180);

            const now = performance.now();
            const last = lastSentRef.current;

            if (
                Math.abs(wServo - (last.w ?? wServo)) >= 1 ||
                Math.abs(cServo - (last.c ?? cServo)) >= 1 ||
                now - last.t > 200
            ) {
                lastSentRef.current = { w: wServo, c: cServo, t: now };
                sendServos(wServo, cServo);
            }

        }, 40); // ~25 Hz

        return () => clearInterval(interval);
    }, []);
    ////////////end of servo updates///////

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
                        <img src={lastXray} alt="Xray" style={{ width: '100%', height: '100%', objectFit: 'contain', transform: 'rotate(-90deg)', filter: beamActive ? 'brightness(1.6) contrast(1.1) drop-shadow(0 0 5px white)' : 'none' }} />
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
                ensureArduinoConnected={ensureArduinoConnected}
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

            {/* Keyboard Legend - Glassmorphism Style */}
            <div style={{
                position: 'absolute',
                bottom: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                gap: '20px',
                padding: '12px 24px',
                background: 'rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                borderRadius: '16px',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
                color: '#fff',
                fontSize: '13px',
                fontWeight: '500',
                pointerEvents: 'none',
                zIndex: 1000
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <kbd style={{
                        padding: '4px 8px',
                        background: 'rgba(255, 255, 255, 0.2)',
                        borderRadius: '6px',
                        border: '1px solid rgba(255, 255, 255, 0.3)',
                        fontFamily: 'monospace',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                    }}>L</kbd>
                    <span style={{ opacity: 0.9 }}>Toggle Landmarks</span>
                </div>
                <div style={{
                    width: '1px',
                    background: 'rgba(255, 255, 255, 0.2)',
                    margin: '0 4px'
                }}></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <kbd style={{
                        padding: '4px 8px',
                        background: 'rgba(255, 255, 255, 0.2)',
                        borderRadius: '6px',
                        border: '1px solid rgba(255, 255, 255, 0.3)',
                        fontFamily: 'monospace',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                    }}>D</kbd>
                    <span style={{ opacity: 0.9 }}>Toggle Debug</span>
                </div>
            </div>
        </div>
    );
};

export default App;