import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import type { EmotionalMode } from '../types';

interface ThreeCanvasProps {
  analyser: React.MutableRefObject<AnalyserNode | null>;
  videoRef: React.RefObject<HTMLVideoElement>;
  emotionalMode: EmotionalMode;
  fidelity?: 'High' | 'Low';
}

const ThreeCanvas: React.FC<ThreeCanvasProps> = ({ analyser, videoRef, emotionalMode, fidelity = 'High' }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ emotionalMode });

  useEffect(() => {
    stateRef.current = { emotionalMode };
  }, [emotionalMode]);

  useEffect(() => {
    if (!mountRef.current) return;

    const isLow = fidelity === 'Low';

    let scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer;
    let vynoLogoPlane: THREE.Group; // Changed to Group for 3D coin model representation
    const clock = new THREE.Clock();
    let mouse = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    let animationId: number;
    
    // Environment Elements
    let terrain1: THREE.Mesh, terrain2: THREE.Mesh;
    let apeirogonGroup: THREE.Group;
    let stars: THREE.Points;
    let molecules: THREE.InstancedMesh;
    let blockGroup: THREE.Group; // Dynamic Web3 floating blockchain blocks
    
    // Core visual elements
    let coreParticles: THREE.Points;
    let particleVelocities: Float32Array;
    let coreLight: THREE.PointLight;
    let innerField: THREE.Mesh;
    let neuralLines: THREE.LineSegments;
    let webNodes: { pos: THREE.Vector3; vel: THREE.Vector3; originalY: number; }[] = [];
    let energyWaves: THREE.Mesh[] = [];
    let clickImpactParticles: THREE.Points[] = [];
    let hologramBeam: THREE.Group;
    let scanRings: THREE.Mesh[] = [];
    
    const MOLECULE_COUNT = isLow ? 35 : 200;
    const WAVE_COUNT = isLow ? 1 : 3;
    const IMPACT_PARTICLE_COUNT = isLow ? 10 : 30;
    
    // Robot definitions
    interface Robot {
        id: number;
        group: THREE.Group;
        headGroup: THREE.Group;
        eyesMaterial: THREE.MeshStandardMaterial;
        leftWing?: THREE.Mesh;
        rightWing?: THREE.Mesh;
        
        path: THREE.CatmullRomCurve3;
        progress: number;
        speed: number;
        
        trailGlobs: THREE.Mesh[]; 
        
        // Upgraded Laser Tool
        laserGroup: THREE.Group;
        laserCore: THREE.Mesh;
        laserGlow: THREE.Mesh;
        chargeOrb: THREE.Mesh;
        chargeParticles: THREE.Points;
        impactParticles: THREE.Points;
        
        laserState: 'idle' | 'charging' | 'firing';
        chargeLevel: number; // 0 to 1
        fireDuration: number;

        isInteract: boolean;
        interactStartTime: number;

        // Combat Stats
        health: number;
        isDead: boolean;
        targetId: number | 'core';
        rebootTime: number;
    }
    let robots: Robot[] = [];
    
    const dataArray = new Uint8Array(256);

    const modeThemes: Record<EmotionalMode, { 
        sky: number, 
        grid: number, 
        core: number, 
        robot: number,
        laser: number
    }> = {
      Professional: { sky: 0x050510, grid: 0x4B0082, core: 0x00FFFF, robot: 0x00FFFF, laser: 0x00FFFF }, 
      Enthusiastic: { sky: 0x1a0a00, grid: 0xFF4500, core: 0xFFD700, robot: 0xFFD700, laser: 0xFFD700 }, 
      Cautious: { sky: 0x001a0a, grid: 0x006400, core: 0x00FF00, robot: 0x20B2AA, laser: 0x00FF00 },
      Zen: { sky: 0x101015, grid: 0xFFB6C1, core: 0xE6E6FA, robot: 0xFF69B4, laser: 0xFFC0CB },
      Thulu: { sky: 0x020a0a, grid: 0x005f5f, core: 0x00FFaa, robot: 0x8A2BE2, laser: 0x00FFaa }
    };

    const playInteractionSound = () => {
        try {
            const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(400, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(800, ctx.currentTime + 0.1);
            osc.frequency.linearRampToValueAtTime(1200, ctx.currentTime + 0.3);
            gain.gain.setValueAtTime(0.05, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
            osc.start();
            osc.stop(ctx.currentTime + 0.5);
        } catch (e) { console.warn(e); }
    };

    // Procedural particle glow graphics engine (avoids flaky CORS and slow server calls)
    const createGlowTexture = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
            gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
            gradient.addColorStop(0.2, 'rgba(0, 255, 255, 0.8)');
            gradient.addColorStop(0.5, 'rgba(0, 100, 255, 0.2)');
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, 64, 64);
        }
        const texture = new THREE.CanvasTexture(canvas);
        return texture;
    };
    const glowTexture = createGlowTexture();

    const init = () => {
      scene = new THREE.Scene();
      scene.background = null;
      scene.fog = new THREE.FogExp2(0x050510, 0.012);
      clock.start();

      const width = window.innerWidth;
      const height = window.innerHeight;

      camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
      camera.position.set(0, 5, 30);
      camera.lookAt(0, 5, -20);

      renderer = new THREE.WebGLRenderer({ antialias: !isLow, alpha: true, powerPreference: 'high-performance' });
      renderer.setSize(width, height);
      renderer.setPixelRatio(isLow ? 1 : Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = !isLow;
      if (mountRef.current) mountRef.current.appendChild(renderer.domElement);

      const ambientLight = new THREE.AmbientLight(0x404040, 2);
      scene.add(ambientLight);

      // Super cool Directional Key Light for pristine glossy metal specular highlights
      const dirLight = new THREE.DirectionalLight(0xffffff, 3.5);
      dirLight.position.set(10, 45, 20);
      scene.add(dirLight);

      createStarfield();
      createInfiniteTerrain();
      createApeirogon(); 
      createCoreParticles(); 
      createMolecules(); 
      createVynoAssets();
      createNeuralWeb();
      createEnergyWaves();
      createBlockchainBlocks(); // Spawns gorgeous rotating Web3 blocks
      
      const path1 = generateComplexPath(25, 12, 0); 
      const path2 = generateComplexPath(30, 18, Math.PI);
      createRobot(path1, 0.0);
      createRobot(path2, 0.4);
      if (!isLow) {
        createRobot(generateComplexPath(35, 20, Math.PI * 0.5), 0.7);
        createRobot(generateComplexPath(20, 10, Math.PI * 1.5), 0.2);
      }
    };

    const createNeuralWeb = () => {
        const nodeCount = isLow ? 25 : 75;
        webNodes = [];
        for (let i = 0; i < nodeCount; i++) {
            const nodePos = new THREE.Vector3(
                (Math.random() - 0.5) * 120,
                -5 + Math.random() * 45,
                -130 + Math.random() * 110
            );
            webNodes.push({
                pos: nodePos,
                vel: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.16,
                    (Math.random() - 0.5) * 0.12,
                    (Math.random() - 0.5) * 0.18
                ),
                originalY: nodePos.y
            });
        }

        const maxLineSegments = isLow ? 80 : 260;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(maxLineSegments * 2 * 3);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        const material = new THREE.LineBasicMaterial({
            color: modeThemes.Professional.core,
            transparent: true,
            opacity: 0.25,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        neuralLines = new THREE.LineSegments(geometry, material);
        scene.add(neuralLines);
    };

    const createBlockchainBlocks = () => {
        blockGroup = new THREE.Group();
        scene.add(blockGroup);

        const blockCount = isLow ? 6 : 20;
        const geom = new THREE.BoxGeometry(1.2, 1.2, 1.2);
        for (let i = 0; i < blockCount; i++) {
            const wireframeGeom = new THREE.EdgesGeometry(geom);
            const mat = new THREE.LineBasicMaterial({
                color: modeThemes.Professional.core,
                transparent: true,
                opacity: 0.6,
                blending: THREE.AdditiveBlending
            });
            const block = new THREE.LineSegments(wireframeGeom, mat);
            
            // Scatter lines elegantly inside the outer edges of the visual stream corridor
            block.position.set(
                (Math.random() - 0.5) * 55,
                Math.random() * 25 - 5,
                -70 + (Math.random() - 0.5) * 110
            );
            
            // Assign custom rotational and speed vectors inside userData properties
            block.userData = {
                rotSpeedX: 0.005 + Math.random() * 0.015,
                rotSpeedY: 0.005 + Math.random() * 0.015,
                floatSpeed: 0.2 + Math.random() * 0.4,
                scaleSpeed: 1 + Math.random() * 1.5
            };
            
            blockGroup.add(block);
        }
    };

    const createEnergyWaves = () => {
        const geo = new THREE.RingGeometry(5, 5.2, 64);
        const mat = new THREE.MeshBasicMaterial({
            color: modeThemes.Professional.core,
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
        });
        for (let i = 0; i < WAVE_COUNT; i++) {
            const wave = new THREE.Mesh(geo, mat.clone());
            wave.position.set(0, 15, -70);
            wave.rotation.x = Math.PI / 2;
            scene.add(wave);
            energyWaves.push(wave);
        }
    };

    const createStarfield = () => {
        const geometry = new THREE.BufferGeometry();
        const count = isLow ? 1000 : 4000;
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        for(let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 800;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 400 + 50;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 600 - 200;
            sizes[i] = Math.random();
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        
        const material = new THREE.PointsMaterial({
            color: 0xffffff, size: 0.6, transparent: true, opacity: 0.8, sizeAttenuation: true,
            blending: THREE.AdditiveBlending
        });
        stars = new THREE.Points(geometry, material);
        scene.add(stars);
    };

    const generateComplexPath = (width: number, height: number, offset: number): THREE.CatmullRomCurve3 => {
        const points: THREE.Vector3[] = [];
        const segmentCount = 14;
        for (let i = 0; i < segmentCount; i++) {
            const t = (i / segmentCount) * Math.PI * 2 + offset;
            const x = Math.sin(t) * width + Math.sin(t * 2.5) * 8;
            const y = Math.cos(t * 1.5) * (height / 2) + 8; 
            const z = Math.cos(t) * 25 - 50; 
            points.push(new THREE.Vector3(x, y, z));
        }
        return new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);
    };

    const generateTerrainGeometry = () => {
        const segments = isLow ? 35 : 80;
        const geometry = new THREE.PlaneGeometry(400, 400, segments, segments);
        geometry.rotateX(-Math.PI / 2);
        const positions = geometry.attributes.position.array as Float32Array;
        for(let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const distFromCenter = Math.abs(x);
            const height = Math.sin(x * 0.08) * 4 + Math.cos(x * 0.4) * 2 + (Math.random() * 1);
            positions[i + 1] = (distFromCenter > 25 ? height + (distFromCenter - 25) * 1.2 : height * 0.05) - 25;
        }
        geometry.computeVertexNormals();
        return geometry;
    };

    const createInfiniteTerrain = () => {
        const geometry = generateTerrainGeometry();
        const material = new THREE.MeshStandardMaterial({
            color: 0x000000, emissive: modeThemes.Professional.grid, emissiveIntensity: 0.5,
            wireframe: true, transparent: true, opacity: 0.25
        });
        terrain1 = new THREE.Mesh(geometry, material);
        terrain1.position.z = -100;
        terrain2 = new THREE.Mesh(geometry, material);
        terrain2.position.z = -500;
        scene.add(terrain1);
        scene.add(terrain2);
    };

    const createApeirogon = () => {
        apeirogonGroup = new THREE.Group();
        apeirogonGroup.position.set(0, 15, -70);
        scene.add(apeirogonGroup);

        const hexPoints: THREE.Vector2[] = [];
        for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
            hexPoints.push(new THREE.Vector2(Math.cos(angle) * 12, Math.sin(angle) * 12));
        }
        const hexShape = new THREE.Shape(hexPoints);
        const hexExtrudeSettings = { depth: 2, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.5 };
        const hexGeo = new THREE.ExtrudeGeometry(hexShape, hexExtrudeSettings);
        const hexMat = new THREE.MeshStandardMaterial({ 
            color: 0x000000, metalness: 1.0, roughness: 0.1, 
            emissive: modeThemes.Professional.core, emissiveIntensity: 0.3 
        });
        const hexagonFrame = new THREE.Mesh(hexGeo, hexMat);
        apeirogonGroup.add(hexagonFrame);

        const nodeGeo = new THREE.SphereGeometry(1.5, 32, 32);
        const nodeMat = new THREE.MeshStandardMaterial({ 
            color: modeThemes.Professional.core, emissive: modeThemes.Professional.core, emissiveIntensity: 2 
        });
        hexPoints.forEach(p => {
            const node = new THREE.Mesh(nodeGeo, nodeMat);
            node.position.set(p.x, p.y, 1);
            apeirogonGroup.add(node);
        });

        const shimmerMat = new THREE.MeshStandardMaterial({ 
            color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.0, metalness: 1, roughness: 0.1
        });
        const branchGeo = new THREE.CylinderGeometry(0.5, 0.5, 8, 12);
        
        const leftY = new THREE.Mesh(branchGeo, shimmerMat);
        leftY.position.set(-2.2, 1.2, 1.2);
        leftY.rotation.z = -Math.PI / 6;
        apeirogonGroup.add(leftY);

        const rightY = new THREE.Mesh(branchGeo, shimmerMat);
        rightY.position.set(2.2, 1.2, 1.2);
        rightY.rotation.z = Math.PI / 6;
        apeirogonGroup.add(rightY);

        const centerY = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 3, 12), shimmerMat);
        centerY.position.set(0, -3.0, 1.2);
        centerY.rotation.z = Math.PI / 2;
        apeirogonGroup.add(centerY);

        const coreOrb = new THREE.Mesh(new THREE.SphereGeometry(4, 32, 32), nodeMat);
        coreOrb.position.z = 1.5;
        apeirogonGroup.add(coreOrb);

        coreLight = new THREE.PointLight(modeThemes.Professional.core, 10, 50);
        coreLight.position.set(0, 0, 3);
        apeirogonGroup.add(coreLight);

        const innerFieldGeo = new THREE.CircleGeometry(11, 6);
        const innerFieldMat = new THREE.MeshBasicMaterial({
            color: modeThemes.Professional.core, transparent: true, opacity: 0.1, side: THREE.DoubleSide
        });
        innerField = new THREE.Mesh(innerFieldGeo, innerFieldMat);
        innerField.position.z = 0.5;
        apeirogonGroup.add(innerField);
    };

    const createCoreParticles = () => {
        const count = isLow ? 300 : 1200;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        particleVelocities = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 4;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 4;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 4;
            const dir = new THREE.Vector3(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5).normalize();
            const speed = 0.08 + Math.random() * 0.2;
            particleVelocities[i * 3] = dir.x * speed;
            particleVelocities[i * 3 + 1] = dir.y * speed;
            particleVelocities[i * 3 + 2] = dir.z * speed;
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({
            color: modeThemes.Professional.core, size: 2.0, map: glowTexture,
            blending: THREE.AdditiveBlending, transparent: true, opacity: 0.8, depthWrite: false
        });
        coreParticles = new THREE.Points(geometry, material);
        apeirogonGroup.add(coreParticles);
    };

    const createMolecules = () => {
        const geometry = new THREE.OctahedronGeometry(0.6, 0);
        const material = new THREE.MeshStandardMaterial({ 
            color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6, transparent: true, opacity: 0.8 
        });
        molecules = new THREE.InstancedMesh(geometry, material, MOLECULE_COUNT);
        const dummy = new THREE.Object3D();
        for(let i=0; i<MOLECULE_COUNT; i++) {
            const r = 35 + Math.random() * 30;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            dummy.position.set(
                r * Math.sin(phi) * Math.cos(theta),
                15 + r * Math.sin(phi) * Math.sin(theta),
                -70 + r * Math.cos(phi)
            );
            dummy.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, 0);
            dummy.scale.setScalar(0.4 + Math.random() * 0.8);
            dummy.updateMatrix();
            molecules.setMatrixAt(i, dummy.matrix);
        }
        scene.add(molecules);
    };

    const createRobot = (path: THREE.CatmullRomCurve3, startProgress: number) => {
        const id = robots.length;
        const group = new THREE.Group();
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.1, metalness: 1.0 });
        const glowMat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 4 });
        const chromeMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.0, metalness: 1.0 });

        const torso = new THREE.Mesh(new THREE.ConeGeometry(0.8, 4, 8), bodyMat);
        torso.rotation.x = Math.PI / 2; group.add(torso);
        const engineGlow = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 16), glowMat);
        engineGlow.position.z = 2.2; group.add(engineGlow);

        const headGroup = new THREE.Group();
        headGroup.position.set(0, 0.6, -1.2); group.add(headGroup);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 1.0), chromeMat); headGroup.add(head);

        const eyeGeo = new THREE.SphereGeometry(0.14);
        const lEye = new THREE.Mesh(eyeGeo, glowMat); lEye.position.set(-0.22, 0, -0.51); headGroup.add(lEye);
        const rEye = new THREE.Mesh(eyeGeo, glowMat); rEye.position.set(0.22, 0, -0.51); headGroup.add(rEye);

        const wingShape = new THREE.Shape();
        wingShape.moveTo(0, 0); wingShape.lineTo(3.5, 2.0); wingShape.lineTo(2.0, 2.8); wingShape.lineTo(0, 0.8);
        const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.15, bevelEnabled: false });
        const lW = new THREE.Mesh(wingGeo, bodyMat); lW.rotation.x = Math.PI / 2; lW.rotation.y = 0.25; lW.position.set(0.3, 0, 0); group.add(lW);
        const rW = new THREE.Mesh(wingGeo, bodyMat); rW.rotation.x = Math.PI / 2; rW.rotation.y = Math.PI - 0.25; rW.rotation.z = Math.PI; rW.position.set(-0.3, 0, 0); group.add(rW);
        
        // Instant position on path so they do not spawn at (0,0,0) and do a weird slide on frame 1
        const initialPos = path.getPoint(startProgress);
        group.position.copy(initialPos);
        const lookPos = path.getPoint((startProgress + 0.015) % 1);
        group.lookAt(lookPos);
        
        scene.add(group);

        const trailGlobs: THREE.Mesh[] = [];
        const globCount = 18;
        const globMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending });
        for(let i=0; i<globCount; i++) {
            const scale = 1.0 - (i / globCount);
            const glob = new THREE.Mesh(new THREE.SphereGeometry(0.5 * scale, 12, 12), globMat.clone());
            glob.visible = false; scene.add(glob); trailGlobs.push(glob);
        }

        // --- UPGRADED LASER ---
        const laserGroup = new THREE.Group();
        group.add(laserGroup);

        const laserCoreGeo = new THREE.CylinderGeometry(0.08, 0.12, 1, 8);
        laserCoreGeo.translate(0, 0.5, 0); laserCoreGeo.rotateX(Math.PI / 2);
        const laserCoreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
        const laserCore = new THREE.Mesh(laserCoreGeo, laserCoreMat);
        laserGroup.add(laserCore);

        const laserGlowGeo = new THREE.CylinderGeometry(0.25, 0.4, 1, 12);
        laserGlowGeo.translate(0, 0.5, 0); laserGlowGeo.rotateX(Math.PI / 2);
        const laserGlowMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending });
        const laserGlow = new THREE.Mesh(laserGlowGeo, laserGlowMat);
        laserGroup.add(laserGlow);

        const chargeOrb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 16), new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0 }));
        chargeOrb.position.set(0, 0, -2);
        group.add(chargeOrb);

        const chargeCount = 40;
        const chargePositions = new Float32Array(chargeCount * 3);
        for(let i=0; i<chargeCount; i++) {
            const r = 2 + Math.random();
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            chargePositions[i*3] = r * Math.sin(phi) * Math.cos(theta);
            chargePositions[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
            chargePositions[i*3+2] = r * Math.cos(phi) - 2;
        }
        const chargeGeo = new THREE.BufferGeometry();
        chargeGeo.setAttribute('position', new THREE.BufferAttribute(chargePositions, 3));
        const chargeParticles = new THREE.Points(chargeGeo, new THREE.PointsMaterial({ color: 0x00ffff, size: 0.25, map: glowTexture, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
        group.add(chargeParticles);

        const impactCount = 50;
        const impactGeo = new THREE.BufferGeometry();
        const impactPosArray = new Float32Array(impactCount * 3);
        impactGeo.setAttribute('position', new THREE.BufferAttribute(impactPosArray, 3));
        const impactParticles = new THREE.Points(impactGeo, new THREE.PointsMaterial({ color: 0x00ffff, size: 0.5, map: glowTexture, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
        scene.add(impactParticles);

        robots.push({
            id, group, headGroup, eyesMaterial: glowMat, path: path, progress: startProgress, 
            speed: 0.08 + Math.random() * 0.04, trailGlobs, 
            laserGroup, laserCore, laserGlow, chargeOrb, chargeParticles, impactParticles,
            laserState: 'idle', chargeLevel: 0, fireDuration: 0,
            isInteract: false, interactStartTime: 0,
            health: 100, isDead: false, targetId: 'core', rebootTime: 0,
            leftWing: lW,
            rightWing: rW
        });

        // Add impact particle pool for this robot
        const impactPGeo = new THREE.BufferGeometry();
        const impactPPosArray = new Float32Array(IMPACT_PARTICLE_COUNT * 3);
        impactPGeo.setAttribute('position', new THREE.BufferAttribute(impactPPosArray, 3));
        const impactPMaterial = new THREE.PointsMaterial({
            color: 0x00ffff, size: 0.8, map: glowTexture, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
        });
        const impactPPoints = new THREE.Points(impactPGeo, impactPMaterial);
        scene.add(impactPPoints);
        clickImpactParticles.push(impactPPoints);
    };

    const createVynoAssets = () => {
        // Create an elegant, futuristic, procedurally generated 3D Web3 Holographic Coin Group!
        const coinGroup = new THREE.Group();
        coinGroup.position.set(0, 33, -80);
        scene.add(coinGroup);

        // Coin Outer Ring Representation (Smooth metallic gold/cyan torus)
        const ringGeo = new THREE.TorusGeometry(6.5, 0.7, 16, 100);
        const ringMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 1.0,
            roughness: 0.05,
            emissive: modeThemes.Professional.core,
            emissiveIntensity: 0.8
        });
        const outerRing = new THREE.Mesh(ringGeo, ringMat);
        coinGroup.add(outerRing);

        // Coin Inner Cylinder (Transparent high-tech digital energy shield)
        const shieldGeo = new THREE.CylinderGeometry(5.8, 5.8, 0.3, 32);
        shieldGeo.rotateX(Math.PI / 2);
        const shieldMat = new THREE.MeshStandardMaterial({
            color: 0x00ffff,
            metalness: 0.7,
            roughness: 0.15,
            transparent: true,
            opacity: 0.45,
            emissive: modeThemes.Professional.core,
            emissiveIntensity: 0.3,
            side: THREE.DoubleSide
        });
        const shield = new THREE.Mesh(shieldGeo, shieldMat);
        coinGroup.add(shield);

        // Letter "V" in the center made of highly glossy glowing digital nodes
        const vGroup = new THREE.Group();
        const letterMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            metalness: 1.0,
            roughness: 0.05,
            emissive: modeThemes.Professional.core,
            emissiveIntensity: 1.6,
        });

        // Left leg of "V"
        const legGeo = new THREE.CylinderGeometry(0.4, 0.4, 5.2, 12);
        const leftLeg = new THREE.Mesh(legGeo, letterMat);
        leftLeg.position.set(-1.1, 0.7, 0.1);
        leftLeg.rotation.z = -Math.PI / 8;
        vGroup.add(leftLeg);

        // Right leg of "V"
        const rightLeg = new THREE.Mesh(legGeo, letterMat);
        rightLeg.position.set(1.1, 0.7, 0.1);
        rightLeg.rotation.z = Math.PI / 8;
        vGroup.add(rightLeg);

        // Bottom connection nub to round off the V base nicely
        const connectionNubGeo = new THREE.SphereGeometry(0.4, 12, 12);
        const connectionNub = new THREE.Mesh(connectionNubGeo, letterMat);
        connectionNub.position.set(0, -1.6, 0.1);
        vGroup.add(connectionNub);

        coinGroup.add(vGroup);
        vynoLogoPlane = coinGroup; // Save group reference

        // --- Beautiful Holographic Projector Beam & Scan Rings ---
        // Projector Core starts at (0, 15, -70) and projects up to the Vyno Coin at (0, 33, -80)
        hologramBeam = new THREE.Group();
        hologramBeam.position.set(0, 15, -70);
        
        // Open-ended cylinder representing the light beam cone
        // Height of cylinder is ~20.6 (distance between core and coin center)
        const beamGeo = new THREE.CylinderGeometry(6.5, 0.5, 20.6, 32, 1, true);
        const beamMat = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.15,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const beamMesh = new THREE.Mesh(beamGeo, beamMat);
        // Position cylinder so its base is at (0,0,0) locally, extending along positive/negative Z
        beamMesh.position.set(0, 0, -10.3);
        beamMesh.rotation.x = Math.PI / 2;
        hologramBeam.add(beamMesh);
        
        // Point the beam directly at the coin
        hologramBeam.lookAt(new THREE.Vector3(0, 33, -80));
        scene.add(hologramBeam);

        // Create elegant, shimmering scan rings
        scanRings = [];
        const ringCount = 3;
        for (let i = 0; i < ringCount; i++) {
            const ringGeo = new THREE.TorusGeometry(1.0, 0.05, 8, 32);
            const ringMat = new THREE.MeshBasicMaterial({
                color: 0x00ffff,
                transparent: true,
                opacity: 0.45,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.rotation.x = Math.PI / 2; // Flat relative to the beam axis
            // Position them spaced out along the local Z axis
            ring.position.z = -((i / ringCount) * 20.6);
            hologramBeam.add(ring);
            scanRings.push(ring);
        }
    };

    const animate = () => {
        if (!renderer || !scene || !camera) return;
        animationId = requestAnimationFrame(animate);
        
        const delta = Math.min(clock.getDelta(), 0.1);
        const time = clock.getElapsedTime();
        const { emotionalMode: currentMode } = stateRef.current;
        
        let currentVolume = 0;
        let rawAudioInfluence = 0;
        if (analyser && analyser.current) {
            try {
                analyser.current.getByteFrequencyData(dataArray);
                currentVolume = dataArray.reduce((prev, curr) => prev + curr, 0) / dataArray.length;
                rawAudioInfluence = Math.min(currentVolume / 70, 1.0);
            } catch (e) {
                // Silently handle analyzer errors if context isn't ready
            }
        }
        // Elegant standby/ambient noise layer so animations never freeze or look static
        const ambientIdle = 0.08 + 0.05 * Math.sin(time * 1.5) + 0.03 * Math.sin(time * 3.7) + 0.01 * Math.cos(time * 8.0);
        const audioInfluence = Math.max(rawAudioInfluence, ambientIdle); 
        const theme = modeThemes[currentMode];

        if (theme) {
            if (scene.fog) {
                (scene.fog as THREE.FogExp2).color.setHex(theme.sky);
                (scene.fog as THREE.FogExp2).density = 0.012 + audioInfluence * 0.008;
            }
            scene.background = null; // High-fidelity blend with CSS background gradient
            if (terrain1.material) {
                (terrain1.material as THREE.MeshStandardMaterial).emissive.setHex(theme.grid);
                (terrain1.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + audioInfluence * 1.8;
            }
            if (terrain2.material) {
                (terrain2.material as THREE.MeshStandardMaterial).emissive.setHex(theme.grid);
                (terrain2.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + audioInfluence * 1.8;
            }
            
            if (neuralLines && neuralLines.material) (neuralLines.material as THREE.LineBasicMaterial).color.setHex(theme.core);
            energyWaves.forEach(w => (w.material as THREE.MeshBasicMaterial).color.setHex(theme.core));
            if (hologramBeam) {
                hologramBeam.children.forEach(child => {
                    const m = child as THREE.Mesh;
                    if (m.material) (m.material as THREE.MeshBasicMaterial).color.setHex(theme.core);
                });
            }

            if (apeirogonGroup) {
                const hexFrame = apeirogonGroup.children[0] as THREE.Mesh;
                if (hexFrame.material) (hexFrame.material as THREE.MeshStandardMaterial).emissive.setHex(theme.core);
                for(let i=1; i<=6; i++) {
                    const node = apeirogonGroup.children[i] as THREE.Mesh;
                    if(node.material) (node.material as THREE.MeshStandardMaterial).emissive.setHex(theme.core);
                }
                const coreOrb = apeirogonGroup.children[10] as THREE.Mesh;
                if(coreOrb.material) (coreOrb.material as THREE.MeshStandardMaterial).emissive.setHex(theme.core);
                
                coreLight.color.setHex(theme.core);
                if (innerField.material) (innerField.material as THREE.MeshBasicMaterial).color.setHex(theme.core);
            }

            if (coreParticles) (coreParticles.material as THREE.PointsMaterial).color.setHex(theme.core);
            robots.forEach(r => {
                r.eyesMaterial.emissive.setHex(theme.robot);
                r.trailGlobs.forEach(g => (g.material as THREE.MeshBasicMaterial).color.setHex(theme.robot));
                (r.laserGlow.material as THREE.MeshBasicMaterial).color.setHex(theme.laser);
                (r.chargeOrb.material as THREE.MeshBasicMaterial).color.setHex(theme.laser);
                (r.chargeParticles.material as THREE.PointsMaterial).color.setHex(theme.laser);
                (r.impactParticles.material as THREE.PointsMaterial).color.setHex(theme.laser);
            });
        }

        const speedFactor = (currentMode === 'Enthusiastic' ? 1.6 : currentMode === 'Zen' ? 0.6 : 1) * (1 + audioInfluence * 0.6);

        // Screen shake on loud audio
        if (audioInfluence > 0.8) {
            camera.position.x += (Math.random() - 0.5) * audioInfluence * 0.5;
            camera.position.y += (Math.random() - 0.5) * audioInfluence * 0.5;
        }

        if (coreParticles && particleVelocities) {
            const positions = coreParticles.geometry.attributes.position.array as Float32Array;
            const particleSpeed = speedFactor * (1 + audioInfluence * 3.5);
            for (let i = 0; i < positions.length / 3; i++) {
                positions[i * 3] += particleVelocities[i * 3] * particleSpeed;
                positions[i * 3 + 1] += particleVelocities[i * 3 + 1] * particleSpeed;
                positions[i * 3 + 2] += particleVelocities[i * 3 + 2] * particleSpeed;
                if (positions[i * 3]**2 + positions[i * 3 + 1]**2 + positions[i * 3 + 2]**2 > 3600) { 
                    positions[i * 3] = (Math.random() - 0.5) * 5;
                    positions[i * 3 + 1] = (Math.random() - 0.5) * 5;
                    positions[i * 3 + 2] = (Math.random() - 0.5) * 5;
                }
            }
            coreParticles.geometry.attributes.position.needsUpdate = true;
        }

        if (stars) {
            const starsPos = stars.geometry.attributes.position.array as Float32Array;
            const stretch = 1 + audioInfluence * 15;
            for(let i=0; i<starsPos.length/3; i++) {
                starsPos[i*3+2] += 2 * speedFactor;
                if(starsPos[i*3+2] > 200) starsPos[i*3+2] = -400;
            }
            stars.scale.set(1, 1, stretch);
            stars.geometry.attributes.position.needsUpdate = true;
        }

        const terrainSpeed = 15 * delta * speedFactor;
        if (terrain1 && terrain2) {
            terrain1.position.z += terrainSpeed;
            terrain2.position.z += terrainSpeed;
            if (terrain1.position.z > 300) terrain1.position.z -= 800;
            if (terrain2.position.z > 300) terrain2.position.z -= 800;
        }

        if (vynoLogoPlane) {
            vynoLogoPlane.position.y = 35 + Math.sin(time * 0.6) * 3;
            const s = 0.8 + audioInfluence * 0.3 + Math.sin(time * 3) * 0.05;
            vynoLogoPlane.scale.set(s, s, s);
            vynoLogoPlane.rotation.y = time * 0.9; // Fluid continuous rotation like a physical holographic coin
            vynoLogoPlane.rotation.x = Math.sin(time * 0.4) * 0.12; // Fine organic tilting accent
        }

        // --- Hologram Beam & Ring Animation ---
        if (hologramBeam && scanRings.length > 0) {
            // Animate primary projector beam opacity with organic shimmering & audio pulses
            const beamMesh = hologramBeam.children[0] as THREE.Mesh;
            if (beamMesh && beamMesh.material) {
                (beamMesh.material as THREE.MeshBasicMaterial).opacity = 0.10 + audioInfluence * 0.22 + Math.sin(time * 8) * 0.03;
            }

            // Slide and scale scan rings along the light projection cone
            scanRings.forEach((ring) => {
                // Move from the base projector (0) upwards to the coin (which is at local Z = -20.6)
                ring.position.z -= delta * 14 * speedFactor;
                if (ring.position.z < -20.6) {
                    ring.position.z = 0; // Wrap back to base
                }
                const t = Math.abs(ring.position.z) / 20.6; // Interpolation factor (0 to 1)
                
                // Conical scaling: 0.5 (base) to 6.5 (coin)
                const currentScale = 0.5 + t * 6.0;
                ring.scale.set(currentScale, currentScale, 1);

                // Fade rings near bottom and top, shimmering with music volume
                const ringMat = ring.material as THREE.MeshBasicMaterial;
                if (ringMat) {
                    ringMat.opacity = (0.05 + audioInfluence * 0.5) * Math.sin(t * Math.PI);
                }
            });
        }

        if (apeirogonGroup) {
            apeirogonGroup.rotation.y += 0.008 * speedFactor;
            apeirogonGroup.rotation.z = Math.sin(time * 0.5) * 0.1;
            
            const coreOrb = apeirogonGroup.children[10];
            const orbPulse = 1 + audioInfluence * 0.8;
            coreOrb.scale.setScalar(orbPulse);
            
            coreLight.intensity = 10 + audioInfluence * 50 + Math.sin(time * 10) * 5;
            
            const yShimmer = 0.5 + 0.5 * Math.sin(time * 4) + audioInfluence * 2;
            for(let i=7; i<=9; i++) {
                const branch = apeirogonGroup.children[i] as THREE.Mesh;
                if (branch.material) (branch.material as THREE.MeshStandardMaterial).emissiveIntensity = yShimmer;
            }

            if (innerField.material) (innerField.material as THREE.MeshBasicMaterial).opacity = 0.05 + audioInfluence * 0.2 + 0.05 * Math.sin(time * 5);
        }

        if (neuralLines) {
            const pos = neuralLines.geometry.attributes.position.array as Float32Array;
            const maxLineSegments = isLow ? 80 : 260;
            const nodesToConnect: THREE.Vector3[] = [];
            
            // Add prominent center nodes
            nodesToConnect.push(new THREE.Vector3(0, 15, -70)); // AI Core Hub
            if (vynoLogoPlane) {
                nodesToConnect.push(vynoLogoPlane.position); // Floating Vyno Coin
            }
            
            // Add robots to nodesToConnect so the lines bridge onto them
            robots.forEach(r => {
                if (r.group && !r.isDead) {
                    nodesToConnect.push(r.group.position);
                }
            });

            // Update drifting cyber nodes & add to connect pool
            webNodes.forEach(node => {
                // Drift physics
                node.pos.x += node.vel.x * delta * 25 * speedFactor;
                node.pos.y += node.vel.y * delta * 25 * speedFactor;
                node.pos.z += node.vel.z * delta * 25 * speedFactor;

                // Subtle organic waviness
                node.pos.y = node.originalY + Math.sin(time * 0.8 + node.pos.x * 0.05) * 4;

                // Enforce safety barriers - wrap or bounce back smoothly
                if (Math.abs(node.pos.x) > 70) {
                    node.vel.x *= -1;
                    node.pos.x = Math.sign(node.pos.x) * 70;
                }
                if (node.pos.y < -15 || node.pos.y > 55) {
                    node.vel.y *= -1;
                    node.pos.y = Math.max(-15, Math.min(55, node.pos.y));
                }
                if (node.pos.z < -160 || node.pos.z > -20) {
                    node.vel.z *= -1;
                    node.pos.z = Math.max(-160, Math.min(-20, node.pos.z));
                }

                nodesToConnect.push(node.pos);
            });

            // Blank/reset coordinate list to secure clean lines
            pos.fill(0);

            let lineIdx = 0;
            const maxDistance = isLow ? 24 : 33;
            const maxDistanceSq = maxDistance * maxDistance;

            for (let i = 0; i < nodesToConnect.length; i++) {
                if (lineIdx >= maxLineSegments) break;
                const p1 = nodesToConnect[i];
                let connectionsCount = 0;
                const maxConnectionsPerNode = isLow ? 2 : 4;

                for (let j = i + 1; j < nodesToConnect.length; j++) {
                    if (lineIdx >= maxLineSegments) break;
                    if (connectionsCount >= maxConnectionsPerNode) break;

                    const p2 = nodesToConnect[j];
                    const dx = p1.x - p2.x;
                    const dy = p1.y - p2.y;
                    const dz = p1.z - p2.z;
                    const dSq = dx*dx + dy*dy + dz*dz;

                    if (dSq < maxDistanceSq) {
                        const startIndex = lineIdx * 6;
                        pos[startIndex] = p1.x;
                        pos[startIndex+1] = p1.y;
                        pos[startIndex+2] = p1.z;
                        pos[startIndex+3] = p2.x;
                        pos[startIndex+4] = p2.y;
                        pos[startIndex+5] = p2.z;

                        lineIdx++;
                        connectionsCount++;
                    }
                }
            }

            neuralLines.geometry.attributes.position.needsUpdate = true;
            (neuralLines.material as THREE.LineBasicMaterial).opacity = 0.15 + audioInfluence * 0.4;
        }

        energyWaves.forEach((wave, i) => {
            const offset = (i / WAVE_COUNT);
            const waveProgress = (time * 0.2 + offset) % 1;
            const s = 1 + waveProgress * 60;
            wave.scale.set(s, s, s);
            (wave.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (1 - waveProgress) * (0.35 + audioInfluence * 0.65));
        });

        if (molecules) {
            molecules.rotation.y -= 0.012 * speedFactor;
            molecules.position.y = Math.sin(time * 0.4) * 2;
        }

        if (blockGroup) {
            blockGroup.children.forEach((block) => {
                const b = block as THREE.LineSegments;
                b.rotation.x += b.userData.rotSpeedX * speedFactor;
                b.rotation.y += b.userData.rotSpeedY * speedFactor;
                
                // Drift forward along the Z corridor
                b.position.z += b.userData.floatSpeed * speedFactor;
                
                // Pulsate in scale elegantly synchronized with real-time sound output or custom periodic wave
                const blockPulse = 1.0 + (audioInfluence * 0.4) * Math.sin(time * b.userData.scaleSpeed);
                b.scale.setScalar(blockPulse);
                
                // Recycle blocks as they exit the far view boundary
                if (b.position.z > 50) {
                    b.position.z = -150;
                    b.position.x = (Math.random() - 0.5) * 55;
                    b.position.y = Math.random() * 25 - 5;
                }
                
                // Synchronize block material color and opacity dynamically with selected mode themes
                if (b.material) {
                    (b.material as THREE.LineBasicMaterial).color.setHex(theme.core);
                    (b.material as THREE.LineBasicMaterial).opacity = 0.3 + audioInfluence * 0.5;
                }
            });
        }

        robots.forEach((robot, robotIdx) => {
            if (robot.isDead) {
                const deadTime = time - robot.rebootTime;
                robot.group.visible = false;
                robot.trailGlobs.forEach(g => g.visible = false);
                (robot.laserCore.material as THREE.MeshBasicMaterial).opacity = 0;
                (robot.laserGlow.material as THREE.MeshBasicMaterial).opacity = 0;
                (robot.chargeOrb.material as THREE.MeshBasicMaterial).opacity = 0;
                (robot.chargeParticles.material as THREE.PointsMaterial).opacity = 0;
                (robot.impactParticles.material as THREE.PointsMaterial).opacity = 0;
                if (deadTime > 5.0) { // Reboot after 5s
                    robot.isDead = false;
                    robot.health = 100;
                    robot.group.visible = true;
                    robot.group.scale.setScalar(0.1); // Growth effect
                }
                return;
            }

            if (robot.group.scale.x < 1.0) {
                robot.group.scale.lerp(new THREE.Vector3(1,1,1), 0.1);
            }

            const movementStep = robot.speed * delta * speedFactor;
            robot.progress = (robot.progress + movementStep) % 1.0;

            const pos = robot.path.getPoint(robot.progress);
            
            // Elegant biological/mechanical hovering bobbing motion
            const hoverBob = Math.sin(time * 3.2 + robotIdx * 1.5) * (0.35 + audioInfluence * 1.3);
            const swayBob = Math.cos(time * 1.8 + robotIdx * 2.0) * (0.2 + audioInfluence * 0.7);
            pos.y += hoverBob;
            pos.x += swayBob;

            // Elegant 3D jitter chatter vibrations during dialogue output
            const jitterVal = audioInfluence * 0.35;
            pos.x += (Math.random() - 0.5) * jitterVal;
            pos.y += (Math.random() - 0.5) * jitterVal;
            pos.z += (Math.random() - 0.5) * jitterVal;
            const lookPos = robot.path.getPoint((robot.progress + 0.015) % 1);
            robot.group.position.lerp(pos, 0.1); // Smoother position
            robot.group.lookAt(lookPos);
            robot.group.rotation.z = -new THREE.Vector3().subVectors(lookPos, pos).normalize().x * 2.5; 

            // Super smooth wing flapping animation reactive to voice / audio analyser influence
            if (robot.leftWing && robot.rightWing) {
                // Flapping speeds up and widens with audio influence
                const flapSpeed = 4.5 + audioInfluence * 20.0;
                const flapAngle = Math.sin(time * flapSpeed + robotIdx * 2) * (0.15 + audioInfluence * 0.5);
                robot.leftWing.rotation.y = 0.25 + flapAngle;
                robot.rightWing.rotation.y = Math.PI - 0.25 - flapAngle;
            } 

            // Trail
            const enginePos = new THREE.Vector3(0, 0, 2.2).applyMatrix4(robot.group.matrixWorld);
            if (robot.trailGlobs.length > 0) {
                robot.trailGlobs[0].visible = true;
                robot.trailGlobs[0].position.lerp(enginePos, 0.6);
                for(let i=1; i < robot.trailGlobs.length; i++) {
                    robot.trailGlobs[i].visible = true;
                    robot.trailGlobs[i].position.lerp(robot.trailGlobs[i-1].position, 0.4); 
                }
            }

            // --- COMBAT AI ---
            const powerThreshold = 0.65;
            const isAudioHigh = audioInfluence > powerThreshold;

            if (robot.laserState === 'idle') {
                if (isAudioHigh || Math.random() < 0.005) {
                    robot.laserState = 'charging';
                    robot.chargeLevel = 0;
                    // Randomly target core or another robot
                    if (Math.random() > 0.6 && robots.length > 1) {
                        const otherIdx = (robotIdx + 1) % robots.length;
                        if (!robots[otherIdx].isDead) {
                            robot.targetId = otherIdx;
                        } else {
                            robot.targetId = 'core';
                        }
                    } else {
                        robot.targetId = 'core';
                    }
                }
            } else if (robot.laserState === 'charging') {
                robot.chargeLevel += delta * 2.0; 
                const orbScale = robot.chargeLevel * 2.0;
                robot.chargeOrb.scale.setScalar(orbScale);
                (robot.chargeOrb.material as THREE.MeshBasicMaterial).opacity = robot.chargeLevel;
                (robot.chargeParticles.material as THREE.PointsMaterial).opacity = robot.chargeLevel;
                
                const posArray = robot.chargeParticles.geometry.attributes.position.array as Float32Array;
                for(let i=0; i<posArray.length/3; i++){
                    const px = posArray[i*3]; const py = posArray[i*3+1]; const pz = posArray[i*3+2] + 2;
                    const d = Math.sqrt(px*px + py*py + pz*pz);
                    if(d < 0.1) {
                        const nr = 2 + Math.random(); const nt = Math.random() * Math.PI * 2; const np = Math.acos(2 * Math.random() - 1);
                        posArray[i*3] = nr * Math.sin(np) * Math.cos(nt);
                        posArray[i*3+1] = nr * Math.sin(np) * Math.sin(nt);
                        posArray[i*3+2] = nr * Math.cos(np) - 2;
                    } else {
                        posArray[i*3] -= px * 0.15; posArray[i*3+1] -= py * 0.15; posArray[i*3+2] -= pz * 0.15;
                    }
                }
                robot.chargeParticles.geometry.attributes.position.needsUpdate = true;

                if (robot.chargeLevel >= 1) {
                    robot.laserState = 'firing';
                    robot.fireDuration = 0;
                }
            } else if (robot.laserState === 'firing') {
                robot.fireDuration += delta;
                
                let targetPos = apeirogonGroup.position.clone();
                let targetRobot: Robot | null = null;
                if (robot.targetId !== 'core') {
                    targetRobot = robots[robot.targetId as number];
                    if (targetRobot && !targetRobot.isDead) {
                        targetPos = targetRobot.group.position.clone();
                    } else {
                        robot.targetId = 'core';
                    }
                }

                const laserTargetLocal = targetPos.clone().applyMatrix4(robot.group.matrixWorld.clone().invert());
                robot.laserGroup.lookAt(laserTargetLocal);
                
                const dist = robot.group.position.distanceTo(targetPos);
                robot.laserCore.scale.z = dist;
                robot.laserGlow.scale.z = dist;

                const pulse = 0.8 + 0.4 * Math.sin(time * 30) + audioInfluence * 0.5;
                robot.laserGlow.scale.x = robot.laserGlow.scale.y = pulse;
                
                (robot.laserCore.material as THREE.MeshBasicMaterial).opacity = 1.0;
                (robot.laserGlow.material as THREE.MeshBasicMaterial).opacity = 0.5 + audioInfluence * 0.5;
                
                // Impact
                (robot.impactParticles.material as THREE.PointsMaterial).opacity = 1.0;
                const impactPos = robot.impactParticles.geometry.attributes.position.array as Float32Array;
                for(let i=0; i<impactPos.length/3; i++) {
                    impactPos[i*3] = targetPos.x + (Math.random() - 0.5) * 4;
                    impactPos[i*3+1] = targetPos.y + (Math.random() - 0.5) * 4;
                    impactPos[i*3+2] = targetPos.z + (Math.random() - 0.5) * 4;
                }
                robot.impactParticles.geometry.attributes.position.needsUpdate = true;

                // Hit detection
                if (targetRobot) {
                    targetRobot.health -= delta * 45;
                    targetRobot.group.scale.setScalar(0.8); // Shrink from impact force
                    targetRobot.group.position.x += (Math.random() - 0.5) * 1.5; // Big kinetic hit shake
                    targetRobot.group.position.y += (Math.random() - 0.5) * 1.5;
                    targetRobot.group.position.z += (Math.random() - 0.5) * 1.5;
                    if (targetRobot.health <= 0) {
                        targetRobot.isDead = true;
                        targetRobot.rebootTime = time;
                        robot.laserState = 'idle'; // Stop firing if target dies
                    }
                }

                if (robot.fireDuration > 1.2 || (!isAudioHigh && robot.fireDuration > 0.4)) {
                    robot.laserState = 'idle';
                    (robot.laserCore.material as THREE.MeshBasicMaterial).opacity = 0;
                    (robot.laserGlow.material as THREE.MeshBasicMaterial).opacity = 0;
                    (robot.chargeOrb.material as THREE.MeshBasicMaterial).opacity = 0;
                    (robot.chargeParticles.material as THREE.PointsMaterial).opacity = 0;
                    (robot.impactParticles.material as THREE.PointsMaterial).opacity = 0;
                }
            }

            if (robot.isInteract) {
                const interactTime = time - robot.interactStartTime;
                if (interactTime < 0.8) {
                    robot.group.rotateZ(0.4); 
                    robot.group.scale.setScalar(1.6 + Math.sin(interactTime * 10) * 0.2);
                    
                    // Update click impact particles
                    const impact = clickImpactParticles[robotIdx];
                    if (impact) {
                        (impact.material as THREE.PointsMaterial).opacity = 1 - (interactTime / 0.8);
                        const iPos = impact.geometry.attributes.position.array as Float32Array;
                        for(let i=0; i<IMPACT_PARTICLE_COUNT; i++){
                            const t = interactTime * 5;
                            const angle = (i / IMPACT_PARTICLE_COUNT) * Math.PI * 2;
                            iPos[i*3] = robot.group.position.x + Math.cos(angle) * t;
                            iPos[i*3+1] = robot.group.position.y + Math.sin(angle) * t;
                            iPos[i*3+2] = robot.group.position.z;
                        }
                        impact.geometry.attributes.position.needsUpdate = true;
                    }
                } else {
                    robot.isInteract = false; robot.group.scale.setScalar(1);
                    const impact = clickImpactParticles[robotIdx];
                    if (impact) (impact.material as THREE.PointsMaterial).opacity = 0;
                }
            }
            robot.headGroup.rotation.y = mouse.x * 0.6;
            robot.headGroup.rotation.x = -mouse.y * 0.4;
        });

        const cameraFloatX = Math.sin(time * 0.4) * 1.5;
        const cameraFloatY = Math.cos(time * 0.3) * 1.0;
        camera.position.x += (mouse.x * 4.5 + cameraFloatX - camera.position.x) * 0.03;
        camera.position.y += (6.0 + (-mouse.y * 3.5) + cameraFloatY - camera.position.y) * 0.03;
        camera.lookAt(0, 6 + Math.sin(time * 0.2) * 0.5, -60);
        renderer.render(scene, camera);
    };

    const onWindowResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    };

    const onDocumentMouseMove = (e: MouseEvent) => {
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    
    const onMouseClick = (e: MouseEvent) => {
        if (!renderer || !camera) return;
        if (e.target !== renderer.domElement) return;
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const activeRobotsGroup = robots.filter(r => !r.isDead).map(r => r.group);
        const intersects = raycaster.intersectObjects(activeRobotsGroup, true);
        if (intersects.length > 0) {
            let hit: THREE.Object3D | null = intersects[0].object;
            let target: Robot | undefined;
            while (hit) {
                target = robots.find(r => r.group === hit);
                if (target) break;
                hit = hit.parent;
            }
            if (target && !target.isDead) {
                target.isInteract = true; 
                target.interactStartTime = clock.getElapsedTime();
                
                // Force into rapid charging state
                target.laserState = 'charging';
                target.chargeLevel = 0.85; // Faster weapon charge on manual stimulus!
                
                const opponents = robots.filter(r => r.id !== target!.id && !r.isDead);
                if (opponents.length > 0 && Math.random() > 0.4) {
                    target.targetId = opponents[Math.floor(Math.random() * opponents.length)].id;
                } else {
                    target.targetId = 'core';
                }
                playInteractionSound();
            }
        }
    };

    try {
        init();
        animate();
    } catch (e) {
        console.error("ThreeCanvas WebGL initialization failed:", e);
    }

    const handleResize = () => {
        if (!camera || !renderer) return;
        const width = window.innerWidth;
        const height = window.innerHeight;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);
    document.addEventListener('mousemove', onDocumentMouseMove);
    window.addEventListener('click', onMouseClick);

    return () => {
        if (animationId) cancelAnimationFrame(animationId);
        window.removeEventListener('resize', handleResize);
        document.removeEventListener('mousemove', onDocumentMouseMove);
        window.removeEventListener('click', onMouseClick);
        if (renderer && mountRef.current && renderer.domElement) {
          try {
            mountRef.current.removeChild(renderer.domElement);
          } catch (e) {
            // ignore
          }
        }
        // Cleanup resources
        if (scene) {
          try {
            scene.traverse((object: any) => {
              if (object.geometry) object.geometry.dispose();
              if (object.material) {
                if (Array.isArray(object.material)) {
                  object.material.forEach((m) => m.dispose());
                } else {
                  object.material.dispose();
                }
              }
            });
          } catch (e) {
            // ignore
          }
        }
        if (renderer) {
          try {
            renderer.dispose();
          } catch (e) {
            // ignore
          }
        }
    };
  }, [fidelity]);

  return <div ref={mountRef} className="fixed top-0 left-0 w-full h-full z-0" />;
};

export default ThreeCanvas;