import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// --- HELPERS ---
const createThickFrame = (size = 0.5) => {
  const group = new THREE.Group();
  const axisRadius = size * 0.04;
  const headRadius = size * 0.08;
  const headLength = size * 0.2;
  const shaftLength = size * 0.8;

  const createArrow = (color, rot) => {
    const arrowGroup = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.3 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(axisRadius, axisRadius, shaftLength, 16), mat);
    shaft.position.y = shaftLength / 2;
    arrowGroup.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(headRadius, headLength, 16), mat);
    head.position.y = shaftLength + headLength / 2;
    arrowGroup.add(head);
    if (rot) arrowGroup.rotation.set(...rot);
    return arrowGroup;
  }
  group.add(createArrow(0x00ff00, [0, 0, 0])); // Y
  group.add(createArrow(0xff0000, [0, 0, -Math.PI / 2])); // X
  group.add(createArrow(0x0000ff, [Math.PI / 2, 0, 0])); // Z
  return group;
};

const createPatient = () => {
    const group = new THREE.Group();
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xffd1b3, roughness: 0.5 });
    const gownMat = new THREE.MeshStandardMaterial({ color: 0x88ccff, roughness: 0.7 });
    
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 32, 32), skinMat);
    head.position.set(0, 0.12, -0.7);
    group.add(head);
    const torso = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.2, 0.6, 4, 0.05), gownMat);
    torso.position.set(0, 0.1, -0.3);
    group.add(torso);
    const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.8, 16), gownMat);
    legL.rotation.x = Math.PI / 2;
    legL.position.set(0.12, 0.08, 0.45);
    group.add(legL);
    const legR = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.8, 16), gownMat);
    legR.rotation.x = Math.PI / 2;
    legR.position.set(-0.12, 0.08, 0.45);
    group.add(legR);
    const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.6, 16), skinMat);
    armL.rotation.z = -0.2;
    armL.rotation.x = Math.PI / 2;
    armL.position.set(0.28, 0.08, -0.3);
    group.add(armL);
    const armR = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.6, 16), skinMat);
    armR.rotation.z = 0.2;
    armR.rotation.x = Math.PI / 2;
    armR.position.set(-0.28, 0.08, -0.3);
    group.add(armR);
    return group;
};

// --- MAIN APP ---
const App = () => {
  const mountRef = useRef(null);
  
  // Controls
  const [controls, setControls] = useState({
    lift: 0.1,          
    column_rot: 0,      
    wig_wag: 0,         
    orbital_slide: 0,
    cart_x: 1.5,   // NEW: Control for cart distance
  });
  const [beamActive, setBeamActive] = useState(false);
  const [lastXray, setLastXray] = useState(null);

  // Refs
  const cartRef = useRef(null); // NEW: Ref for the entire machine cart
  const columnRotRef = useRef(new THREE.Group());
  const liftRef = useRef(new THREE.Group());
  const wigWagRef = useRef(new THREE.Group());
  const cArmSlideRef = useRef(new THREE.Group());
  const beamRef = useRef(null);

  const handleTakeXray = () => {
    setBeamActive(true);
    setTimeout(() => {
        setBeamActive(false);
        setLastXray(`data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%231a1a1a'/%3E%3Cpath d='M50 10 Q45 20 50 30 T50 50 T50 70 T50 90' stroke='%23ddd' stroke-width='8' fill='none' opacity='0.8'/%3E%3Cpath d='M30 25 Q50 25 70 25' stroke='%23ddd' stroke-width='4' opacity='0.5'/%3E%3Cpath d='M32 35 Q50 35 68 35' stroke='%23ddd' stroke-width='4' opacity='0.5'/%3E%3Cpath d='M35 45 Q50 45 65 45' stroke='%23ddd' stroke-width='4' opacity='0.5'/%3E%3Cpath d='M38 55 Q50 55 62 55' stroke='%23ddd' stroke-width='4' opacity='0.5'/%3E%3Cpath d='M40 65 Q50 65 60 65' stroke='%23ddd' stroke-width='4' opacity='0.5'/%3E%3Ctext x='5' y='95' fill='white' font-family='monospace' font-size='10'%3ER%3C/text%3E%3C/svg%3E`);
    }, 500);
  };

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
    orbit.target.set(0, 0.8, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(5, 10, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    scene.add(sun);

    // --- ENVIRONMENT (Clinic) ---
    // Floor
    const floorGeo = new THREE.PlaneGeometry(30, 30);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xe0e6eb, roughness: 0.6 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    scene.add(floor);

    // Back Wall
    const wallGeo = new THREE.PlaneGeometry(30, 15);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf5f7fa, roughness: 0.5 });
    
    const backWall = new THREE.Mesh(wallGeo, wallMat);
    backWall.position.set(0, 7.5, -6); // Positioned behind the bed
    backWall.receiveShadow = true;
    scene.add(backWall);

    // --- MATERIALS ---
    const matWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
    const matOrange = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.2 });
    const matYellow = new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: 0.3 });
    const matBlue = new THREE.MeshStandardMaterial({ color: 0x0077ff, emissive: 0x0022aa, emissiveIntensity: 0.5 });
    const matDark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
    const matCarbon = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.3 });
    const matSteel = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3, metalness: 0.6 });

    // --- SCENE ---
    
    // PATIENT & BED
    const bedGroup = new THREE.Group();
    scene.add(bedGroup);
    
    // Bed Top
    const tableTop = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.05, 2.0, 4, 0.01), matCarbon);
    tableTop.position.y = 1.35; 
    tableTop.receiveShadow = true;
    bedGroup.add(tableTop);

    // Bed Legs
    const legGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.35, 16);
    [
        { x: 0.25, z: 0.9 }, { x: -0.25, z: 0.9 },
        { x: 0.25, z: -0.9 }, { x: -0.25, z: -0.9 }
    ].forEach(pos => {
        const leg = new THREE.Mesh(legGeo, matSteel);
        leg.position.set(pos.x, 0.675, pos.z); 
        leg.castShadow = true;
        bedGroup.add(leg);
    });

    const bedFrame = createThickFrame(0.4);
    bedFrame.position.set(0, 1.4, 0); 
    bedGroup.add(bedFrame);
    
    const patient = createPatient();
    patient.position.y = 1.38; 
    bedGroup.add(patient);

    // ROBOT CART
    const cartRoot = new THREE.Group();
    cartRoot.position.set(1.5, 0, 0); 
    cartRoot.rotation.y = -Math.PI / 2; 
    scene.add(cartRoot);
    cartRef.current = cartRoot; // Bind ref for movement

    const chassis = new THREE.Mesh(new RoundedBoxGeometry(0.8, 0.5, 1.1, 4, 0.05), matWhite);
    chassis.position.y = 0.35; 
    chassis.castShadow = true;
    cartRoot.add(chassis);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.02, 1.12), matOrange);
    stripe.position.y = 0.6;
    cartRoot.add(stripe);
    const wheelGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.25, 32);
    [ {x: 0.35, z: 0.35}, {x: -0.35, z: 0.35}, {x: 0.35, z: -0.35}, {x: -0.35, z: -0.35} ].forEach(pos => {
        const cover = new THREE.Mesh(new THREE.SphereGeometry(0.16, 32, 16, 0, Math.PI * 2, 0, Math.PI/2), matWhite);
        cover.position.set(pos.x, 0.15, pos.z);
        cartRoot.add(cover);
    });

    // KINEMATICS
    const colBaseGroup = new THREE.Group();
    colBaseGroup.position.set(0, 0.6, 0.45); 
    cartRoot.add(colBaseGroup);

    const colRotGroup = new THREE.Group();
    colBaseGroup.add(colRotGroup);
    columnRotRef.current = colRotGroup;

    // --- COLUMN EXTENSION ---
    // Lowered to 1.15m (1.5 - 0.35)
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

    // C-ARM RING
    const cRadius = 0.8;
    const cSlideGroup = new THREE.Group();
    cSlideGroup.position.set(0, 0, cRadius); 
    wigWagGroup.add(cSlideGroup);
    cArmSlideRef.current = cSlideGroup;

    // C-Shape
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

    // --- 1. DETECTOR (Top Tip) ---
    const detGroup = new THREE.Group();
    detGroup.position.set(0, cRadius, 0); 
    cSlideGroup.add(detGroup);

    const detHousing = new THREE.Group();
    detHousing.rotation.set(Math.PI, 0, 0); 
    detGroup.add(detHousing);

    // SMOOTH CONNECTION UPGRADE
    const detNeck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.2, 0.05, 32), 
        matWhite
    );
    detNeck.position.y = 0.025; 
    detHousing.add(detNeck);

    const detCollar = new THREE.Mesh(
        new THREE.TorusGeometry(0.14, 0.02, 16, 32),
        matWhite
    );
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

    // Add Frame here (On top of detector tip/face)
    const armFrame = createThickFrame(0.4);
    armFrame.position.y = 0.3; // At the face
    detHousing.add(armFrame);

    // --- 2. SOURCE (Bottom Tip) ---
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

    // BEAM
    const beamHeight = 1.29; 
    const beamGeo = new THREE.ConeGeometry(0.2, beamHeight, 32, 1, true); 
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 0.26 + beamHeight/2; 
    beam.visible = false;
    srcHousing.add(beam);
    beamRef.current = beam;

    // --- LOOP ---
    const animate = () => {
      requestAnimationFrame(animate);
      orbit.update();
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
    // Lift Logic Updated: Lowered base offset by 0.35m (1.55 -> 1.20)
    if (liftRef.current) liftRef.current.position.y = 1.20 + controls.lift;
    if (columnRotRef.current) columnRotRef.current.rotation.y = controls.column_rot;
    if (wigWagRef.current) wigWagRef.current.rotation.z = controls.wig_wag;
    if (cArmSlideRef.current) cArmSlideRef.current.rotation.x = controls.orbital_slide;
    if (cartRef.current) cartRef.current.position.x = controls.cart_x; // Update cart position
  }, [controls]);

  useEffect(() => {
      if (beamRef.current) {
          beamRef.current.visible = beamActive;
          beamRef.current.material.opacity = beamActive ? 0.4 : 0.0;
      }
  }, [beamActive]);

  const containerStyle = { position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: '#eef2f5', fontFamily: 'sans-serif', color: '#333' };
  // CONTROLS REPOSITIONED HERE: Top 260px (220+20+20), Left 20px
  const controlsStyle = { position: 'absolute', top: '260px', left: '20px', width: '280px', backgroundColor: 'rgba(255,255,255,0.9)', padding: '20px', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.1)', pointerEvents: 'auto' };
  const xrayStyle = { position: 'absolute', top: '20px', left: '20px', width: '200px', height: '220px', backgroundColor: '#000', borderRadius: '8px', border: '2px solid #333', display: 'flex', flexDirection: 'column', overflow: 'hidden', pointerEvents: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' };

  return (
    <div style={containerStyle}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
      <div style={xrayStyle}>
          <div style={{ backgroundColor: '#222', color: '#fff', padding: '5px 10px', fontSize: '11px', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }}>
              <span>LIVE FLUORO</span>
              {beamActive && <span style={{ color: 'red' }}>● EXPOSURE</span>}
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
              {lastXray ? <img src={lastXray} alt="Xray" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.9 }} /> : <span style={{ color: '#555', fontSize: '10px' }}>NO IMAGE</span>}
              <div style={{ position: 'absolute', width: '100%', height: '1px', background: 'rgba(255,255,255,0.2)'}}></div>
              <div style={{ position: 'absolute', height: '100%', width: '1px', background: 'rgba(255,255,255,0.2)'}}></div>
          </div>
      </div>
      <div style={controlsStyle}>
         <div style={{ display: 'flex', alignItems: 'center', marginBottom: '15px' }}>
            <div style={{ width: '30px', height: '30px', background: '#ff6600', borderRadius: '6px', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', marginRight: '10px' }}>C</div>
            <div><h3 style={{ margin: 0, fontSize: '14px' }}>CIARTIC Move</h3><span style={{ fontSize: '10px', color: '#888' }}>ROBOTIC SYSTEM</span></div>
         </div>
         {['cart_x', 'lift', 'orbital_slide', 'wig_wag', 'column_rot'].map(key => (
             <div key={key} style={{ marginBottom: '15px' }}>
                 <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase', color: '#555' }}>
                     {key.replace('_', ' ')}
                     <span style={{ color: '#ff6600' }}>{
                        key === 'lift' ? controls[key].toFixed(2) + 'm' : 
                        key === 'cart_x' ? controls[key].toFixed(2) + 'm' :
                        (controls[key] * 180 / Math.PI).toFixed(0) + '°'
                     }</span>
                 </div>
                 <input type="range" 
                    min={key === 'lift' ? -0.5 : (key === 'cart_x' ? 0.8 : (key === 'orbital_slide' ? -1.5 : (key === 'wig_wag' ? -0.4 : -1.5)))} 
                    max={key === 'lift' ? 0.5 : (key === 'cart_x' ? 2.5 : (key === 'orbital_slide' ? 1.5 : (key === 'wig_wag' ? 0.4 : 1.5)))} 
                    step="0.01" 
                    value={controls[key]} 
                    onChange={e => setControls({...controls, [key]: parseFloat(e.target.value)})} 
                    style={{ width: '100%', cursor: 'pointer' }} />
             </div>
         ))}
         <div style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '15px' }}>
             <button onClick={handleTakeXray} style={{ width: '100%', padding: '12px', backgroundColor: beamActive ? '#ff0000' : '#333', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', transition: 'background 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                 <span style={{ fontSize: '16px' }}>☢</span> TAKE X-RAY
             </button>
         </div>
      </div>
    </div>
  );
};

export default App;