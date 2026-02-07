import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// --- CONFIGURATION ---
const PATIENT_URL = 'https://raw.githubusercontent.com/iyad-salameh/C_arm_guidance_APAH/main/assets/patient.glb?v=3';
const CARM_URL = 'https://raw.githubusercontent.com/iyad-salameh/C_arm_guidance_APAH/main/assets/c-armModel.glb?v=1';
const realsense_URL = 'https://raw.githubusercontent.com/iyad-salameh/C_arm_guidance_APAH/main/assets/realsense.glb?v=1';
const ISO_WORLD = new THREE.Vector3(0, 1.45, 0);


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

    // Scene Graph Refs
    const cartRef = useRef(null);
    const columnRotRef = useRef(new THREE.Group());
    const liftRef = useRef(new THREE.Group());
    const wigWagRef = useRef(new THREE.Group());
    const cArmSlideRef = useRef(new THREE.Group());
    const beamRef = useRef(null);
    const cArmModelRef = useRef(null);
    const srcAnchorRef = useRef(new THREE.Group());
    const detAnchorRef = useRef(new THREE.Group());

    // --- DYNAMIC ANATOMY GENERATOR ---
    const generateRealisticXray = () => {
        const { cart_x, orbital_slide, wig_wag } = controls;

        // 1. Determine Anatomy Zone based on Cart X position
        // Tuning these ranges based on the patient position (0, 1.45, 0) relative to cart
        let anatomyType = "Unknown";
        let svgContent = "";

        // Normalize rotation for view width (cos effect for rotation)
        const viewWidth = Math.abs(Math.cos(orbital_slide)) * 0.8 + 0.2;
        const spineOffset = Math.sin(orbital_slide) * 20; // Spine moves off-center during rotation

        // -- GENERATION LOGIC --
        if (cart_x < 1.2) {
            anatomyType = "HEAD / NECK";
            // Skull & Cervical Spine
            svgContent = `
            <ellipse cx="${50 + spineOffset * 0.5}" cy="40" rx="${30 * viewWidth}" ry="35" fill="#ddd" opacity="0.9" filter="url(#blur)" />
            <path d="M ${50 + spineOffset * 0.5 - 20 * viewWidth} 50 Q ${50 + spineOffset * 0.5} 80 ${50 + spineOffset * 0.5 + 20 * viewWidth} 50" stroke="#aaa" stroke-width="3" fill="none" opacity="0.8" />
            <rect x="${45 + spineOffset}" y="70" width="10" height="15" rx="3" fill="#eee" opacity="0.9" />
            <rect x="${45 + spineOffset}" y="88" width="10" height="15" rx="3" fill="#eee" opacity="0.9" />
        `;
        } else if (cart_x >= 1.2 && cart_x < 1.7) {
            anatomyType = "CHEST / THORAX";
            // Ribs & Thoracic Spine
            // Scroll effect: use cart_x decimals to shift ribs up/down
            const scrollY = (cart_x % 0.2) * 500;

            let ribs = "";
            for (let i = 0; i < 6; i++) {
                const yBase = (i * 18) - scrollY + 20;
                if (yBase > -10 && yBase < 110) {
                    ribs += `
                    <path d="M ${50 + spineOffset} ${yBase} Q ${10} ${yBase + 10} ${15} ${yBase + 25}" stroke="#ccc" stroke-width="4" fill="none" opacity="0.5" filter="url(#blur)" />
                    <path d="M ${50 + spineOffset} ${yBase} Q ${90} ${yBase + 10} ${85} ${yBase + 25}" stroke="#ccc" stroke-width="4" fill="none" opacity="0.5" filter="url(#blur)" />
                `;
                }
            }

            let spine = "";
            for (let i = 0; i < 8; i++) {
                const yBase = (i * 12) - scrollY + 10;
                if (yBase > -10 && yBase < 110) {
                    spine += `<rect x="${44 + spineOffset}" y="${yBase}" width="12" height="10" rx="2" fill="#eee" opacity="0.8" />`;
                }
            }

            // Heart Shadow (only visible in AP mostly)
            const heartOpacity = Math.max(0, Math.cos(orbital_slide) * 0.3);
            const heart = `<ellipse cx="${60 + spineOffset}" cy="60" rx="20" ry="25" fill="#eee" opacity="${heartOpacity}" filter="url(#blur)" />`;

            svgContent = ribs + spine + heart;

        } else if (cart_x >= 1.7 && cart_x < 2.1) {
            anatomyType = "ABDOMEN / PELVIS";
            // Lumbar Spine & Pelvis Wings
            const scrollY = (cart_x % 0.2) * 400;

            let spine = "";
            for (let i = 0; i < 5; i++) {
                const yBase = (i * 16) - scrollY + 10;
                if (yBase > -10 && yBase < 110) {
                    spine += `<rect x="${42 + spineOffset}" y="${yBase}" width="16" height="14" rx="3" fill="#eee" opacity="0.9" />`;
                }
            }

            // Pelvis only appears at the bottom of this range
            let pelvis = "";
            if (cart_x > 1.9) {
                pelvis = `
                <path d="M ${50 + spineOffset} 60 Q ${10} 60 ${15} 100" stroke="#ddd" stroke-width="15" fill="none" opacity="0.7" filter="url(#blur)" />
                <path d="M ${50 + spineOffset} 60 Q ${90} 60 ${85} 100" stroke="#ddd" stroke-width="15" fill="none" opacity="0.7" filter="url(#blur)" />
            `;
            }

            svgContent = spine + pelvis;

        } else {
            anatomyType = "LEGS / FEMUR";
            // Long bones
            const scrollY = (cart_x % 0.5) * 200;

            svgContent = `
            <rect x="${35 + spineOffset}" y="-20" width="12" height="140" rx="5" fill="#ddd" opacity="0.8" filter="url(#blur)" />
            <rect x="${55 + spineOffset}" y="-20" width="12" height="140" rx="5" fill="#ddd" opacity="0.8" filter="url(#blur)" />
            <rect x="${38 + spineOffset}" y="${80 - scrollY}" width="6" height="140" fill="#fff" opacity="0.3" /> 
        `;
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

    const handleTakeXray = () => {
        setBeamActive(true);
        setTimeout(() => {
            try {
                setLastXray(generateRealisticXray());
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
            new THREE.MeshBasicMaterial({ color: 0xff00ff, visible: false })
        );
        isoMarker.position.copy(ISO_WORLD);
        scene.add(isoMarker);
        isoMarker.add(new THREE.AxesHelper(0.2));

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

        const tableTop = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.05, 2.0, 4, 0.01), matCarbon);
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

        // --- LOAD MODELS ---
        const loader = new GLTFLoader();

        // 1. Patient Model
        loader.load(
            PATIENT_URL,
            (gltf) => {
                const model = gltf.scene;
                const box = new THREE.Box3().setFromObject(model);
                const size = new THREE.Vector3();
                box.getSize(size);
                const maxDim = Math.max(size.x, size.y, size.z);
                if (maxDim > 0) {
                    const desiredHeight = 1.7;
                    const scaleFactor = desiredHeight / maxDim;
                    model.scale.set(scaleFactor, scaleFactor, scaleFactor);
                } else {
                    model.scale.set(1.0, 1.0, 1.0);
                }
                model.rotation.set(-Math.PI / 2, 0, Math.PI);
                model.position.set(0, 1.45, 0.0);

                model.traverse((node) => {
                    if (node.isMesh) {
                        node.castShadow = true;
                        node.receiveShadow = true;
                    }
                });

                bedGroup.add(model);
                setModelLoading(false);
            },
            undefined,
            (error) => { console.error(error); setModelLoading(false); }
        );

        // 2. Extra C-Arm Model (Background)
        loader.load(
            CARM_URL,
            (gltf) => {
                const cArmModel = gltf.scene;
                cArmModelRef.current = cArmModel;
                cArmModel.position.set(1.5, 0, -2.0);

                cArmModel.traverse((node) => {
                    if (node.isMesh) {
                        node.castShadow = true;
                        node.receiveShadow = true;
                        // White material override
                        node.material = new THREE.MeshStandardMaterial({
                            color: 0xffffff,
                            roughness: 0.4,
                            metalness: 0.2
                        });
                    }
                });

                scene.add(cArmModel);
            },
            undefined,
            (error) => { console.error(error); }
        );

        // 3. realsense Model
        loader.load(
            realsense_URL,
            (gltf) => {
                const model = gltf.scene;
                const box = new THREE.Box3().setFromObject(model);
                const size = new THREE.Vector3();
                box.getSize(size);
                const maxDim = Math.max(size.x, size.y, size.z);
                if (maxDim > 0) {
                    const desiredHeight = 0.15;
                    const scaleFactor = desiredHeight / maxDim;
                    model.scale.set(scaleFactor, scaleFactor, scaleFactor);
                } else {
                    model.scale.set(0.15, 0.15, 0.15);
                }
                model.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
                model.position.set(-0.22, 2.16, 0.0);

                model.traverse((node) => {
                    if (node.isMesh) {
                        node.castShadow = true;
                        node.receiveShadow = true;
                    }
                });

                bedGroup.add(model);
                setModelLoading(false);
            },
            undefined,
            (error) => { console.error(error); setModelLoading(false); }
        );

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
        const wheelGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.25, 32);
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
        const beamGeo = new THREE.ConeGeometry(0.2, 1.0, 32, 1, true);
        beamGeo.translate(0, 0.5, 0); // Pivot at base
        const beamMat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
        const beam = new THREE.Mesh(beamGeo, beamMat);
        srcAnchor.add(beam);
        beamRef.current = beam;

        // Vectors
        const v1 = new THREE.Vector3();
        const v2 = new THREE.Vector3();
        const vSeg = new THREE.Vector3();
        const vecToI = new THREE.Vector3();
        const closestPoint = new THREE.Vector3();

        const animate = () => {
            requestAnimationFrame(animate);
            orbit.update();

            // PHYSICS LOOP
            if (srcAnchorRef.current && detAnchorRef.current && beamRef.current) {
                srcAnchorRef.current.getWorldPosition(v1);
                detAnchorRef.current.getWorldPosition(v2);
                const distance = v1.distanceTo(v2);
                beamRef.current.scale.set(1, distance, 1);

                // --- DEBUG UPDATE ---
                if (debugEnabledRef.current) {
                    if (isoMarker) isoMarker.visible = true;

                    const now = performance.now();
                    if (now - lastDebugUpdateRef.current > 100) { // 10Hz
                        lastDebugUpdateRef.current = now;

                        const midpoint = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5);
                        const distToIso = midpoint.distanceTo(ISO_WORLD);

                        // IsoLine Logic (Distance from ISO to source-detector ray)
                        vSeg.subVectors(v2, v1);
                        const lenSq = vSeg.lengthSq();
                        vecToI.subVectors(ISO_WORLD, v1);
                        let t = lenSq > 0 ? vecToI.dot(vSeg) / lenSq : 0;
                        t = Math.max(0, Math.min(1, t));
                        closestPoint.copy(v1).addScaledVector(vSeg, t);
                        const isoLineDist = closestPoint.distanceTo(ISO_WORLD);

                        const newReadout = {
                            src: v1.toArray().map(n => n.toFixed(3)),
                            det: v2.toArray().map(n => n.toFixed(3)),
                            sid: distance.toFixed(3),
                            midToIso: distToIso.toFixed(3),
                            isoLine: isoLineDist.toFixed(3),
                        };
                        setDebugReadout(newReadout);
                    }
                } else {
                    if (isoMarker) isoMarker.visible = false;
                }
            }

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
            window.removeEventListener('resize', handleResize);
            if (mountRef.current) mountRef.current.innerHTML = '';
            renderer.dispose();
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
        if (beamRef.current) {
            beamRef.current.visible = beamActive;
            beamRef.current.material.opacity = beamActive ? 0.4 : 0.0;
        }
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
                    <div>SRC: [{debugReadout.src.join(', ')}]</div>
                    <div>DET: [{debugReadout.det.join(', ')}]</div>
                    <div>SID: {debugReadout.sid} m</div>
                    <div>IsoDist: {debugReadout.midToIso} m</div>
                    <div>IsoLine: {debugReadout.isoLine} m</div>
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
                {['cart_x', 'cart_z', 'lift', 'orbital_slide', 'wig_wag', 'column_rot'].map(key => (
                    <div key={key} style={{ marginBottom: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase', color: '#666' }}>
                            {key.replace('_', ' ')}
                            <span style={{ color: '#ff6600' }}>{
                                (key === 'lift' || key === 'cart_x' || key === 'cart_z') ? controls[key].toFixed(2) + 'm' :
                                    (controls[key] * 180 / Math.PI).toFixed(0) + '°'
                            }</span>
                        </div>
                        <input type="range"
                            min={key === 'lift' ? -0.5 : (key === 'cart_x' ? 0.8 : (key === 'cart_z' ? -1.5 : (key === 'orbital_slide' ? -1.5 : (key === 'wig_wag' ? -0.4 : -1.5))))}
                            max={key === 'lift' ? 0.5 : (key === 'cart_x' ? 2.5 : (key === 'cart_z' ? 1.5 : (key === 'orbital_slide' ? 1.5 : (key === 'wig_wag' ? 0.4 : 1.5))))}
                            step="0.01"
                            value={controls[key]}
                            onChange={e => setControls({ ...controls, [key]: parseFloat(e.target.value) })}
                            style={{ width: '100%', cursor: 'pointer' }} />
                    </div>
                ))}
                <div style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '15px' }}>
                    <button onClick={handleTakeXray} disabled={beamActive} style={{ width: '100%', padding: '12px', backgroundColor: beamActive ? '#ff0000' : '#333', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: beamActive ? 'not-allowed' : 'pointer', transition: 'background 0.2s' }}>
                        {beamActive ? 'EXPOSING...' : 'TAKE X-RAY'}
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