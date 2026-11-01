/**
 * Orlume Computer Graphics UI/UX Engine — v4.3
 * Three.js 3D Interactive Cards with Cursor as Live Light Source
 * Floating Frosted Navbar, Ambient Light Field, Scroll Reveal,
 * Touch Support, ResizeObserver, FAQ Accordion, Code Tab Switcher,
 * Newsletter AJAX, Keyboard Shortcuts
 */

import * as THREE from 'three';

document.addEventListener('DOMContentLoaded', () => {

  // ── Prefers-reduced-motion check ──────────────────────────────────────────
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Scroll Reveal via IntersectionObserver ─────────────────────────────────
  // Adds `.revealed` to elements with class `.reveal` when they enter viewport.
  const revealEls = document.querySelectorAll('.reveal');
  const revealObs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('revealed');
        revealObs.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });
  revealEls.forEach(el => revealObs.observe(el));

  // ── Active nav link via IntersectionObserver ───────────────────────────────
  // Highlights the matching nav link when a section is in view.
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-link[href^="#"]');

  const sectionObs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const id = e.target.getAttribute('id');
        navLinks.forEach(link => {
          link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
        });
      }
    });
  }, { threshold: 0.45 });
  sections.forEach(s => sectionObs.observe(s));

  // ── Mobile Hamburger Toggle ────────────────────────────────────────────────
  const hamburgerBtn = document.querySelector('.nav-hamburger');
  const studioHeaderEl = document.querySelector('.studio-header');
  if (hamburgerBtn && studioHeaderEl) {
    hamburgerBtn.addEventListener('click', () => {
      const isOpen = studioHeaderEl.classList.toggle('nav-mobile-open');
      hamburgerBtn.setAttribute('aria-expanded', String(isOpen));
    });

    // Close mobile menu when a link is clicked
    document.querySelectorAll('.nav-mobile-links .nav-link').forEach(link => {
      link.addEventListener('click', () => {
        studioHeaderEl.classList.remove('nav-mobile-open');
        hamburgerBtn.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ── Header scroll shadow ───────────────────────────────────────────────────
  const studioHeader = document.querySelector('.studio-header');
  const handleScroll = () => {
    if (!studioHeader) return;
    if (window.scrollY > 20) {
      studioHeader.classList.add('header-scrolled');
    } else {
      studioHeader.classList.remove('header-scrolled');
    }
  };
  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();

  // ============================================================
  // 1. Hidden Interactive Monocular Metric Depth Background
  //    Reveals live 3D depth mesh only when user hovers across page
  // ============================================================
  if (!prefersReducedMotion) {
    const bgCanvas = document.getElementById('bg-graphics-canvas');
    if (bgCanvas) {
      let width  = bgCanvas.width  = window.innerWidth;
      let height = bgCanvas.height = window.innerHeight;

      const bgScene  = new THREE.Scene();
      const bgCamera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
      bgCamera.position.set(0, -2.4, 5.2);
      bgCamera.rotation.x = 0.42;

      const bgRenderer = new THREE.WebGLRenderer({
        canvas: bgCanvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
      });
      bgRenderer.setSize(width, height);
      bgRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

      // Lights
      const cursorLight = new THREE.PointLight(0x0284C7, 0, 14, 1.4);
      cursorLight.position.set(0, 0, 1.8);
      bgScene.add(cursorLight);

      const rimLight = new THREE.PointLight(0x0D9488, 0, 10, 1.6);
      rimLight.position.set(0, 0, 1.2);
      bgScene.add(rimLight);

      // Monocular Metric Depth Geometry (Topological Mesh)
      const gridCols = 80, gridRows = 50, gridWidth = 20, gridHeight = 13;
      const depthGeo = new THREE.PlaneGeometry(gridWidth, gridHeight, gridCols, gridRows);

      const depthShaderMat = new THREE.ShaderMaterial({
        wireframe: true,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime:           { value: 0 },
          uMouse:          { value: new THREE.Vector2(0, 0) },
          uLightZ:         { value: 1.6 },
          uRadius:         { value: 3.8 },
          uHoverIntensity: { value: 0.0 },
          uScrollProgress: { value: 0.0 },
          uPrimaryColor:   { value: new THREE.Color(0x0284C7) },
          uSecondaryColor: { value: new THREE.Color(0x2563EB) },
          uSpecularColor:  { value: new THREE.Color(0xFFFFFF) }
        },
        vertexShader: `
          uniform float uTime;
          uniform vec2  uMouse;
          uniform float uLightZ;
          uniform float uRadius;
          uniform float uHoverIntensity;
          uniform float uScrollProgress;

          varying vec3  vNormal;
          varying vec3  vViewDir;
          varying vec3  vLightDir;
          varying float vDistToLight;
          varying float vGlow;

          float computeElevation(vec2 p, float glowVal, float t, float scrollShift) {
            float wave1 = sin(p.x * 1.5 + t * 1.2 + scrollShift) * cos(p.y * 1.5 + t * 0.9) * 0.32;
            float wave2 = sin(p.x * 3.0 - t * 0.7 + p.y * 1.1) * 0.16;
            float relief = (wave1 + wave2) * (0.32 + glowVal * 0.75);
            float cursorDome = glowVal * 0.45;
            return relief + cursorDome;
          }

          void main() {
            float dist = length(position.xy - uMouse);
            float glow = exp(-(dist * dist) / (uRadius * uRadius)) * uHoverIntensity;
            vGlow = glow;

            float scrollShift = uScrollProgress * 4.2;
            float depthDisplacement = computeElevation(position.xy, glow, uTime, scrollShift);
            vec3 newPos = position + vec3(0.0, 0.0, depthDisplacement);

            float eps = 0.035;
            float distX  = length(vec2(position.x + eps, position.y) - uMouse);
            float glowX  = exp(-(distX * distX) / (uRadius * uRadius)) * uHoverIntensity;
            float zX     = computeElevation(vec2(position.x + eps, position.y), glowX, uTime, scrollShift);

            float distY  = length(vec2(position.x, position.y + eps) - uMouse);
            float glowY  = exp(-(distY * distY) / (uRadius * uRadius)) * uHoverIntensity;
            float zY     = computeElevation(vec2(position.x, position.y + eps), glowY, uTime, scrollShift);

            float dzdx = (zX - depthDisplacement) / eps;
            float dzdy = (zY - depthDisplacement) / eps;

            vec3 objNormal = normalize(vec3(-dzdx, -dzdy, 1.0));
            vNormal = normalMatrix * objNormal;

            vec4 worldPos = modelMatrix * vec4(newPos, 1.0);
            vec3 lightPos = vec3(uMouse.x, uMouse.y, uLightZ);
            vec3 toLight  = lightPos - worldPos.xyz;
            vDistToLight  = length(toLight);
            vLightDir     = normalize(toLight);
            vViewDir      = normalize(cameraPosition - worldPos.xyz);

            gl_Position = projectionMatrix * viewMatrix * worldPos;
          }
        `,
        fragmentShader: `
          uniform vec3  uPrimaryColor;
          uniform vec3  uSecondaryColor;
          uniform vec3  uSpecularColor;
          uniform float uHoverIntensity;

          varying vec3  vNormal;
          varying vec3  vViewDir;
          varying vec3  vLightDir;
          varying float vDistToLight;
          varying float vGlow;

          void main() {
            if (vGlow < 0.015) { discard; }

            vec3 N = normalize(vNormal);
            vec3 L = normalize(vLightDir);
            vec3 V = normalize(vViewDir);
            vec3 H = normalize(L + V);

            float lightAtten = 1.0 / (1.0 + vDistToLight * 0.18 + vDistToLight * vDistToLight * 0.025);
            float NdotL = max(dot(N, L), 0.0);
            float diffuse = NdotL * lightAtten;

            float NdotH = max(dot(N, H), 0.0);
            float specular = pow(NdotH, 18.0) * 1.45 * lightAtten;

            float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.2) * 0.45;

            vec3 depthBaseColor = mix(uPrimaryColor * 0.72, uSecondaryColor * 0.58, 0.45);
            vec3 activeColor    = mix(uPrimaryColor * 1.35, uSecondaryColor * 1.20, vGlow * 0.5 + diffuse * 0.5);
            vec3 surfaceColor   = mix(depthBaseColor, activeColor, clamp(diffuse * 1.4 + vGlow * 0.75, 0.0, 1.0));
            vec3 reflectiveGleam = uSpecularColor * (specular * 1.05 + fresnel * 0.40);
            vec3 litColor = surfaceColor + reflectiveGleam;

            float alpha = clamp(vGlow * 0.68 + diffuse * 0.22 + specular * 0.18, 0.0, 0.78) * uHoverIntensity;
            gl_FragColor = vec4(litColor, alpha);
          }
        `
      });

      const depthMesh = new THREE.Mesh(depthGeo, depthShaderMat);
      depthMesh.renderOrder = 2;
      bgScene.add(depthMesh);

      // Secondary translucent terrain surface
      const depthSurfaceMat = new THREE.ShaderMaterial({
        wireframe: false,
        transparent: true,
        depthWrite: false,
        uniforms: depthShaderMat.uniforms,
        vertexShader: depthShaderMat.vertexShader,
        fragmentShader: `
          uniform vec3  uPrimaryColor;
          uniform vec3  uSecondaryColor;
          uniform vec3  uSpecularColor;
          uniform float uHoverIntensity;

          varying vec3  vNormal;
          varying vec3  vViewDir;
          varying vec3  vLightDir;
          varying float vDistToLight;
          varying float vGlow;

          void main() {
            if (vGlow < 0.02) { discard; }

            vec3 N = normalize(vNormal);
            vec3 L = normalize(vLightDir);
            vec3 V = normalize(vViewDir);
            vec3 H = normalize(L + V);

            float lightAtten = 1.0 / (1.0 + vDistToLight * 0.22 + vDistToLight * vDistToLight * 0.035);
            float NdotL = max(dot(N, L), 0.0);
            float diffuse = NdotL * lightAtten;
            float NdotH = max(dot(N, H), 0.0);
            float specular = pow(NdotH, 14.0) * 0.85 * lightAtten;

            vec3 surfaceAura = mix(uPrimaryColor * 0.50, uSecondaryColor * 0.40, diffuse * 0.6);
            vec3 litSurface  = surfaceAura + uSpecularColor * (specular * 0.45);
            float alpha = clamp(vGlow * 0.10 + diffuse * 0.08 + specular * 0.06, 0.0, 0.16) * uHoverIntensity;
            gl_FragColor = vec4(litSurface, alpha);
          }
        `
      });

      const surfaceMesh = new THREE.Mesh(depthGeo, depthSurfaceMat);
      surfaceMesh.renderOrder = 1;
      bgScene.add(surfaceMesh);

      // Scroll color palettes (Zero Purple)
      const scrollPalettes = [
        { stop: 0.00, primary: new THREE.Color(0x0EA5E9), secondary: new THREE.Color(0x2563EB), specular: new THREE.Color(0x38BDF8) },
        { stop: 0.25, primary: new THREE.Color(0x06B6D4), secondary: new THREE.Color(0x0EA5E9), specular: new THREE.Color(0x67E8F9) },
        { stop: 0.48, primary: new THREE.Color(0x14B8A6), secondary: new THREE.Color(0x06B6D4), specular: new THREE.Color(0x5EEAD4) },
        { stop: 0.70, primary: new THREE.Color(0xF59E0B), secondary: new THREE.Color(0xF97316), specular: new THREE.Color(0xFDE047) },
        { stop: 0.88, primary: new THREE.Color(0x10B981), secondary: new THREE.Color(0x14B8A6), specular: new THREE.Color(0x6EE7B7) },
        { stop: 1.00, primary: new THREE.Color(0x3B82F6), secondary: new THREE.Color(0x0EA5E9), specular: new THREE.Color(0x93C5FD) }
      ];

      const activePrimary   = new THREE.Color(0x0EA5E9);
      const activeSecondary = new THREE.Color(0x2563EB);
      const activeSpecular  = new THREE.Color(0x38BDF8);

      function updateColorsForScroll(progress) {
        const p = Math.max(0, Math.min(1, progress));
        for (let i = 0; i < scrollPalettes.length - 1; i++) {
          const p0 = scrollPalettes[i], p1 = scrollPalettes[i + 1];
          if (p >= p0.stop && p <= p1.stop) {
            const t = (p - p0.stop) / (p1.stop - p0.stop);
            const easeT = t * t * (3 - 2 * t); // Hermite cubic
            activePrimary.copy(p0.primary).lerp(p1.primary, easeT);
            activeSecondary.copy(p0.secondary).lerp(p1.secondary, easeT);
            activeSpecular.copy(p0.specular).lerp(p1.specular, easeT);
            return;
          }
        }
        const last = scrollPalettes[scrollPalettes.length - 1];
        activePrimary.copy(last.primary);
        activeSecondary.copy(last.secondary);
        activeSpecular.copy(last.specular);
      }

      let mouseX = 0, mouseY = 0;
      let targetMouseX = 0, targetMouseY = 0;
      let hoverIntensity = 0.90;
      let targetHoverIntensity = 0.90;
      let idleTimer = setTimeout(() => { targetHoverIntensity = 0; }, 3200);

      let targetScrollProgress = 0;
      let smoothedScrollProgress = 0;

      const handleBgScroll = () => {
        const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
        targetScrollProgress = Math.min(Math.max(window.scrollY / maxScroll, 0), 1);
        if (targetHoverIntensity > 0) {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => { targetHoverIntensity = 0; }, 2600);
        }
      };
      window.addEventListener('scroll', handleBgScroll, { passive: true });
      handleBgScroll();

      const handlePointerMove = (e) => {
        const nx = (e.clientX / window.innerWidth) * 2 - 1;
        const ny = -(e.clientY / window.innerHeight) * 2 + 1;
        targetMouseX = nx * 8.2;
        targetMouseY = ny * 5.2 - 0.4;
        targetHoverIntensity = 1.0;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => { targetHoverIntensity = 0; }, 2600);
      };

      const handlePointerLeave = () => { targetHoverIntensity = 0; };

      window.addEventListener('mousemove', handlePointerMove, { passive: true });
      window.addEventListener('mouseleave', handlePointerLeave);
      window.addEventListener('blur', handlePointerLeave);

      window.addEventListener('resize', () => {
        width  = window.innerWidth;
        height = window.innerHeight;
        bgCamera.aspect = width / height;
        bgCamera.updateProjectionMatrix();
        bgRenderer.setSize(width, height);
        handleBgScroll();
      }, { passive: true });

      function renderBackgroundDepth(time) {
        requestAnimationFrame(renderBackgroundDepth);
        const t = time * 0.001;

        hoverIntensity += (targetHoverIntensity - hoverIntensity) * 0.06;
        mouseX += (targetMouseX - mouseX) * 0.08;
        mouseY += (targetMouseY - mouseY) * 0.08;
        smoothedScrollProgress += (targetScrollProgress - smoothedScrollProgress) * 0.07;
        updateColorsForScroll(smoothedScrollProgress);

        if (hoverIntensity > 0.005) {
          depthShaderMat.uniforms.uTime.value           = t;
          depthShaderMat.uniforms.uMouse.value.set(mouseX, mouseY);
          depthShaderMat.uniforms.uHoverIntensity.value = hoverIntensity;
          depthShaderMat.uniforms.uScrollProgress.value = smoothedScrollProgress;
          depthShaderMat.uniforms.uPrimaryColor.value.copy(activePrimary);
          depthShaderMat.uniforms.uSecondaryColor.value.copy(activeSecondary);
          depthShaderMat.uniforms.uSpecularColor.value.copy(activeSpecular);

          const zRot = Math.sin(t * 0.2) * 0.015;
          depthMesh.rotation.z   = zRot;
          surfaceMesh.rotation.z = zRot;

          bgRenderer.render(bgScene, bgCamera);
        } else if (depthShaderMat.uniforms.uHoverIntensity.value > 0) {
          depthShaderMat.uniforms.uHoverIntensity.value = 0;
          bgRenderer.clear();
        }
      }

      renderBackgroundDepth(0);
    }
  }

  // ============================================================
  // 2. Three.js 3D Cards: Mouse Cursor as Live Light Source
  // ============================================================
  const cardData = [
    { canvasId: 'canvas-card-1', cardId: 'card-pillar-1', badgeId: 'telemetry-card-1', type: 'icosahedron', lightColor: 0xFBBF24, rimColor: 0x0284C7 },
    { canvasId: 'canvas-card-2', cardId: 'card-pillar-2', badgeId: 'telemetry-card-2', type: 'depth-plane',  lightColor: 0x38BDF8, rimColor: 0x0D9488 },
    { canvasId: 'canvas-card-3', cardId: 'card-pillar-3', badgeId: 'telemetry-card-3', type: 'torus',        lightColor: 0xF59E0B, rimColor: 0x0284C7 }
  ];

  const cardScenes = [];

  cardData.forEach((cfg, idx) => {
    const canvas  = document.getElementById(cfg.canvasId);
    const cardEl  = document.getElementById(cfg.cardId);
    const badgeEl = document.getElementById(cfg.badgeId);
    if (!canvas || !cardEl) return;

    // Use ResizeObserver for accurate canvas sizing
    const stage = canvas.parentElement;
    let w = stage.clientWidth  || 320;
    let h = stage.clientHeight || 230;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080E1A);

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    camera.position.set(0, 0, 3.4);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;

    scene.add(new THREE.AmbientLight(0x0F172A, 0.6));

    const cursorLight = new THREE.PointLight(cfg.lightColor, 4.2, 10, 1.2);
    cursorLight.position.set(0.6, 0.5, 1.4);
    scene.add(cursorLight);

    const rimLight = new THREE.PointLight(cfg.rimColor, 1.8, 8, 1.5);
    rimLight.position.set(-1.0, -0.7, 0.8);
    scene.add(rimLight);

    const gizmoMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 16, 16),
      new THREE.MeshBasicMaterial({ color: cfg.lightColor })
    );
    gizmoMesh.position.copy(cursorLight.position);
    scene.add(gizmoMesh);

    let meshObject;

    if (cfg.type === 'icosahedron') {
      const geo = new THREE.IcosahedronGeometry(0.95, 2);
      geo.computeVertexNormals();
      meshObject = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: 0xE2E8F0, roughness: 0.22, metalness: 0.25, flatShading: true
      }));
      scene.add(meshObject);

    } else if (cfg.type === 'depth-plane') {
      const geo = new THREE.PlaneGeometry(2.0, 1.5, 28, 20);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i), v = pos.getY(i);
        pos.setZ(i, Math.sin(u * 3.5) * Math.cos(v * 3.5) * 0.22);
      }
      geo.computeVertexNormals();
      meshObject = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: 0x38BDF8, wireframe: true, roughness: 0.3
      }));
      meshObject.rotation.x = -0.35;
      scene.add(meshObject);

    } else if (cfg.type === 'torus') {
      const geo = new THREE.TorusGeometry(0.85, 0.26, 24, 48);
      meshObject = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: 0x0D9488, roughness: 0.28, metalness: 0.45
      }));
      scene.add(meshObject);
    }

    let targetLightX = 0.6, targetLightY = 0.5;
    let currentLightX = targetLightX, currentLightY = targetLightY;
    let isHovering = false;

    cardEl.addEventListener('mousemove', (e) => {
      const rect = cardEl.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      const ny = -(((e.clientY - rect.top)  / rect.height) * 2 - 1);
      targetLightX = nx * 1.6;
      targetLightY = ny * 1.2;
      isHovering = true;
      if (badgeEl) {
        const sx = targetLightX >= 0 ? `+${targetLightX.toFixed(2)}` : targetLightX.toFixed(2);
        const sy = targetLightY >= 0 ? `+${targetLightY.toFixed(2)}` : targetLightY.toFixed(2);
        badgeEl.textContent = `Light: [${sx}, ${sy}]`;
      }
    }, { passive: true });

    cardEl.addEventListener('mouseleave', () => { isHovering = false; });

    // ResizeObserver for the card canvas stage
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const newW = entry.contentRect.width;
        const newH = entry.contentRect.height;
        if (newW > 0 && newH > 0) {
          camera.aspect = newW / newH;
          camera.updateProjectionMatrix();
          renderer.setSize(newW, newH);
        }
      }
    });
    ro.observe(stage);

    cardScenes.push({
      renderer, scene, camera, meshObject, cursorLight, gizmoMesh,
      update: (time) => {
        if (!isHovering) {
          targetLightX = Math.sin(time + idx * 1.8) * 0.85;
          targetLightY = Math.cos(time * 0.8 + idx) * 0.55;
        }
        currentLightX += (targetLightX - currentLightX) * 0.08;
        currentLightY += (targetLightY - currentLightY) * 0.08;

        cursorLight.position.x = currentLightX;
        cursorLight.position.y = currentLightY;
        cursorLight.position.z = 1.35 + Math.sin(time * 1.8) * 0.08;
        gizmoMesh.position.copy(cursorLight.position);

        if (cfg.type === 'depth-plane' && meshObject) {
          const pos = meshObject.geometry.attributes.position;
          for (let i = 0; i < pos.count; i++) {
            const u = pos.getX(i), v = pos.getY(i);
            const wave = Math.sin(u * 3.6 + time * 1.8) * Math.cos(v * 3.6 + time * 1.4) * 0.22
                       + Math.sin(u * 5.2 - time) * 0.05;
            pos.setZ(i, wave);
          }
          pos.needsUpdate = true;
          meshObject.geometry.computeVertexNormals();
          meshObject.rotation.y = Math.sin(time * 0.4) * 0.12;
          meshObject.rotation.x = -0.42 + Math.cos(time * 0.3) * 0.03;
        } else if (meshObject) {
          meshObject.rotation.y += 0.005;
          meshObject.rotation.x += 0.002;
        }

        renderer.render(scene, camera);
      }
    });
  });

  // Global animation loop for 3D cards
  if (!prefersReducedMotion && cardScenes.length > 0) {
    function animateCards() {
      requestAnimationFrame(animateCards);
      const time = performance.now() * 0.0015;
      cardScenes.forEach(s => s.update(time));
    }
    animateCards();
  }

  // ============================================================
  // 3. Interactive Studio Playground (Direct 3D Relighting)
  // ============================================================
  const pgCanvas   = document.getElementById('playground-canvas');
  const pgViewport = document.getElementById('playground-viewport');
  const hudCoords  = document.getElementById('pg-hud-coords');
  const hudKelvin  = document.getElementById('pg-hud-kelvin');

  const sliderKelvin    = document.getElementById('pg-slider-kelvin');
  const sliderIntensity = document.getElementById('pg-slider-intensity');
  const sliderGloss     = document.getElementById('pg-slider-gloss');

  const valKelvin    = document.getElementById('val-pg-kelvin');
  const valIntensity = document.getElementById('val-pg-intensity');
  const valGloss     = document.getElementById('val-pg-gloss');

  const presetBtns = document.querySelectorAll('.preset-btn');

  if (pgCanvas && pgViewport) {
    const pgWidth  = pgViewport.clientWidth  || 500;
    const pgHeight = pgViewport.clientHeight || 420;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070D18);

    const camera = new THREE.PerspectiveCamera(42, pgWidth / pgHeight, 0.1, 50);
    camera.position.set(0, 0, 3.5);

    const renderer = new THREE.WebGLRenderer({
      canvas: pgCanvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(pgWidth, pgHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;

    scene.add(new THREE.AmbientLight(0x0F172A, 0.7));

    let currentLightColor = 0xF59E0B;
    const keyLight = new THREE.PointLight(currentLightColor, 4.8, 12, 1.2);
    keyLight.position.set(0.9, 0.7, 1.5);
    scene.add(keyLight);

    const rimLight = new THREE.PointLight(0x0284C7, 2.2, 10, 1.5);
    rimLight.position.set(-1.2, -0.8, 0.9);
    scene.add(rimLight);

    const puckMat = new THREE.MeshBasicMaterial({ color: currentLightColor });
    const puckMesh = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 16), puckMat);
    puckMesh.position.copy(keyLight.position);
    scene.add(puckMesh);

    const subjectGeo = new THREE.IcosahedronGeometry(1.05, 3);
    subjectGeo.computeVertexNormals();
    const subjectMat = new THREE.MeshStandardMaterial({
      color: 0xE2E8F0, roughness: 0.25, metalness: 0.2, flatShading: false
    });
    const subjectMesh = new THREE.Mesh(subjectGeo, subjectMat);
    scene.add(subjectMesh);

    const ringMesh = new THREE.Mesh(
      new THREE.RingGeometry(1.06, 1.075, 64),
      new THREE.MeshBasicMaterial({ color: 0x0284C7, side: THREE.DoubleSide, opacity: 0.35, transparent: true })
    );
    ringMesh.rotation.x = Math.PI / 2.2;
    scene.add(ringMesh);

    let targetX = 0.9, targetY = 0.7;
    let currentX = targetX, currentY = targetY;
    let isUserDragging = false;

    // Mouse tracking across viewport
    pgViewport.addEventListener('mousemove', (e) => {
      const rect = pgViewport.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      targetX = nx * 1.8;
      targetY = ny * 1.4;
      isUserDragging = true;
    });

    pgViewport.addEventListener('mouseleave', () => { isUserDragging = false; });

    // Touch event support for mobile
    pgViewport.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const rect  = pgViewport.getBoundingClientRect();
      const nx = ((touch.clientX - rect.left) / rect.width)  * 2 - 1;
      const ny = -(((touch.clientY - rect.top) / rect.height) * 2 - 1);
      targetX = nx * 1.8;
      targetY = ny * 1.4;
      isUserDragging = true;
    }, { passive: false });

    pgViewport.addEventListener('touchend', () => { isUserDragging = false; });

    // Helper: Kelvin → RGB hex
    function kelvinToHex(kelvin) {
      const temp = kelvin / 100;
      let red, green, blue;
      if (temp <= 66) {
        red   = 255;
        green = 99.4708025861 * Math.log(temp) - 161.1195681661;
        blue  = temp <= 19 ? 0 : 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
      } else {
        red   = 329.698727446  * Math.pow(temp - 60, -0.1332047592);
        green = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
        blue  = 255;
      }
      red   = Math.min(255, Math.max(0, red));
      green = Math.min(255, Math.max(0, green));
      blue  = Math.min(255, Math.max(0, blue));
      return (Math.round(red) << 16) | (Math.round(green) << 8) | Math.round(blue);
    }

    function setKelvin(kelvin) {
      currentLightColor = kelvinToHex(kelvin);
      keyLight.color.setHex(currentLightColor);
      puckMat.color.setHex(currentLightColor);
      if (valKelvin)  valKelvin.textContent = `${kelvin}K`;
      if (hudKelvin) {
        const desc = kelvin < 3600 ? 'Warm Sun' : kelvin < 6200 ? 'Daylight' : 'Cool Sky';
        hudKelvin.textContent = `${kelvin}K ${desc}`;
      }
    }

    // Preset button handlers
    presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        presetBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        targetX = parseFloat(btn.dataset.x) || 0;
        targetY = parseFloat(btn.dataset.y) || 0;
        const k = parseInt(btn.dataset.temp) || 5600;
        if (sliderKelvin) sliderKelvin.value = k;
        setKelvin(k);
      });
    });

    // Slider inputs
    if (sliderKelvin) {
      sliderKelvin.addEventListener('input', (e) => {
        setKelvin(parseInt(e.target.value));
        presetBtns.forEach(b => b.classList.remove('active'));
      });
    }
    if (sliderIntensity) {
      sliderIntensity.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        keyLight.intensity = (val / 100) * 4.8;
        if (valIntensity) valIntensity.textContent = `${val}%`;
      });
    }
    if (sliderGloss) {
      sliderGloss.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        subjectMat.roughness = Math.max(0.05, 1 - val / 100);
        if (valGloss) valGloss.textContent = `${val}%`;
      });
    }

    // Playground animation loop
    if (!prefersReducedMotion) {
      function animatePlayground() {
        requestAnimationFrame(animatePlayground);
        currentX += (targetX - currentX) * 0.12;
        currentY += (targetY - currentY) * 0.12;
        keyLight.position.set(currentX, currentY, 1.5);
        puckMesh.position.copy(keyLight.position);
        subjectMesh.rotation.y += 0.004;
        if (hudCoords) {
          const sx = currentX >= 0 ? `+${currentX.toFixed(2)}` : currentX.toFixed(2);
          const sy = currentY >= 0 ? `+${currentY.toFixed(2)}` : currentY.toFixed(2);
          hudCoords.textContent = `[${sx}, ${sy}, +1.50]`;
        }
        renderer.render(scene, camera);
      }
      animatePlayground();
    }

    // Viewport resize
    window.addEventListener('resize', () => {
      const w = pgViewport.clientWidth;
      const h = pgViewport.clientHeight;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    }, { passive: true });
  }

  // ============================================================
  // 4. Hero Video Autoplay Management
  // ============================================================
  const video = document.getElementById('hero-demo-video');
  if (video) {
    video.play().catch(() => {
      video.muted = true;
      video.play().catch(() => {});
    });
  }

  // ============================================================
  // 5. FAQ Accordion Logic — toggle .active class only
  //    CSS handles smooth max-height transition (no display:none toggle)
  // ============================================================
  const faqPanels = document.querySelectorAll('.faq-panel');
  faqPanels.forEach(panel => {
    const trigger = panel.querySelector('.faq-trigger');
    if (trigger) {
      trigger.addEventListener('click', () => {
        const isActive = panel.classList.contains('active');
        // Collapse all
        faqPanels.forEach(p => p.classList.remove('active'));
        // Re-open if it wasn't already open
        if (!isActive) {
          panel.classList.add('active');
        }
      });
    }
  });

  // ============================================================
  // 6. Code & Shader Inspector Tab Switcher
  // ============================================================
  const codeTabs = document.querySelectorAll('.code-tab');
  const codeBlocks = {
    shader:   document.getElementById('tab-shader'),
    onnx:     document.getElementById('tab-onnx'),
    pipeline: document.getElementById('tab-pipeline')
  };

  codeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      codeTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      Object.keys(codeBlocks).forEach(key => {
        if (codeBlocks[key]) {
          codeBlocks[key].style.display = key === target ? 'block' : 'none';
        }
      });
    });
  });

  // ============================================================
  // 7. Community Newsletter FormSubmit AJAX Handler
  // ============================================================
  const nlForm    = document.getElementById('newsletter-form');
  const nlSuccess = document.getElementById('newsletter-success');
  const nlBtn     = document.getElementById('nl-submit-btn');

  if (nlForm && nlBtn && nlSuccess) {
    nlForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const originalHTML = nlBtn.innerHTML;
      nlBtn.innerHTML = '<span>Subscribing...</span>';
      nlBtn.disabled = true;
      nlBtn.style.opacity = '0.75';

      try {
        const formData = new FormData(nlForm);
        const res = await fetch('https://formsubmit.co/ajax/orlumevisionlabs@gmail.com', {
          method: 'POST',
          body: formData,
          headers: { 'Accept': 'application/json' }
        });

        if (res.ok) {
          nlForm.style.display = 'none';
          nlSuccess.style.display = 'inline-flex';
        } else {
          throw new Error('Subscription service error');
        }
      } catch (err) {
        console.warn('Newsletter submission fallback:', err);
        nlForm.style.display = 'none';
        nlSuccess.style.display = 'inline-flex';
      }
    });
  }

  // ============================================================
  // 8. Global Keyboard Shortcuts
  // ============================================================
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'e' || e.key === 'E') {
      window.location.href = '/editor';
    }
  });

});
