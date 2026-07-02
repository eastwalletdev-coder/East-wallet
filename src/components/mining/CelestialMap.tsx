"use client"

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Logo } from '@/components/brand/Logo';

export function CelestialMap() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);

    // Earth Sphere (Holographic style)
    const earthGeometry = new THREE.SphereGeometry(1.8, 64, 64);
    const earthMaterial = new THREE.MeshPhongMaterial({
      color: 0x7c3aed,
      emissive: 0x2e1065,
      shininess: 40,
      wireframe: true,
      transparent: true,
      opacity: 0.2
    });
    const earth = new THREE.Mesh(earthGeometry, earthMaterial);
    scene.add(earth);

    // Inner glowing core
    const coreGeometry = new THREE.SphereGeometry(1.4, 32, 32);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.05
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    scene.add(core);

    // Outer glow ring
    const ringGeometry = new THREE.TorusGeometry(2.2, 0.01, 16, 100);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x7c3aed, transparent: true, opacity: 0.3 });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2;
    scene.add(ring);

    // Floating Particles (Stars)
    const starGeometry = new THREE.BufferGeometry();
    const starCount = 2000;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i++) {
      starPositions[i] = (Math.random() - 0.5) * 30;
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.015, transparent: true, opacity: 0.6 });
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);

    // Active Node Points
    const nodeGeometry = new THREE.BufferGeometry();
    const nodeCount = 12;
    const nodePositions = new Float32Array(nodeCount * 3);
    for (let i = 0; i < nodeCount; i++) {
      const phi = Math.acos(-1 + (2 * i) / nodeCount);
      const theta = Math.sqrt(nodeCount * Math.PI) * phi;
      const radius = 1.82;
      nodePositions[i * 3] = radius * Math.cos(theta) * Math.sin(phi);
      nodePositions[i * 3 + 1] = radius * Math.sin(theta) * Math.sin(phi);
      nodePositions[i * 3 + 2] = radius * Math.cos(phi);
    }
    nodeGeometry.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3));
    const nodeMaterial = new THREE.PointsMaterial({ color: 0x3b82f6, size: 0.08, transparent: true, opacity: 1 });
    const nodes = new Points(nodeGeometry, nodeMaterial);
    scene.add(nodes);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);
    const spotLight = new THREE.SpotLight(0x7c3aed, 2);
    spotLight.position.set(10, 10, 10);
    scene.add(spotLight);

    const animate = () => {
      requestAnimationFrame(animate);
      earth.rotation.y += 0.001;
      core.rotation.y -= 0.0005;
      stars.rotation.y += 0.0001;
      nodes.rotation.y += 0.001;
      ring.rotation.z += 0.002;

      // Gentle movement
      const time = Date.now() * 0.001;
      earth.position.y = Math.sin(time) * 0.05;

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div ref={containerRef} className="w-full h-[55vh] relative">
      <div className="absolute top-10 left-0 right-0 text-center pointer-events-none z-10">
        <Logo size="lg" />
        <div className="flex items-center justify-center space-x-2 mt-4">
          <span className="w-12 h-[1px] bg-gradient-to-r from-transparent to-primary"></span>
          <p className="text-primary text-[10px] font-black tracking-[0.3em] uppercase opacity-90">
            Hybrid Ledger Protocol
          </p>
          <span className="w-12 h-[1px] bg-gradient-to-l from-transparent to-primary"></span>
        </div>
      </div>
    </div>
  );
}

// Fixed missing import in Three.js context
class Points extends THREE.Points {}