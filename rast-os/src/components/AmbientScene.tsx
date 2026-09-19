"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export default function AmbientScene() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        powerPreference: "low-power",
      });
    } catch {
      return;
    }

    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    renderer.domElement.className = "ambient-canvas";
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.z = 6.5;

    const random = seededRandom(90210);
    const positions = new Float32Array(96 * 3);
    for (let index = 0; index < positions.length; index += 3) {
      positions[index] = (random() - 0.5) * 11;
      positions[index + 1] = (random() - 0.5) * 7;
      positions[index + 2] = (random() - 0.5) * 5;
    }

    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const pointMaterial = new THREE.PointsMaterial({
      color: 0xb8f252,
      opacity: 0.2,
      size: 0.035,
      sizeAttenuation: true,
      transparent: true,
    });
    const points = new THREE.Points(pointGeometry, pointMaterial);
    scene.add(points);

    const solidGeometry = new THREE.IcosahedronGeometry(1.35, 1);
    const lineGeometry = new THREE.EdgesGeometry(solidGeometry);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x8bdcff,
      opacity: 0.075,
      transparent: true,
    });
    const wire = new THREE.LineSegments(lineGeometry, lineMaterial);
    wire.position.set(2.5, 0.45, -0.8);
    scene.add(wire);

    const pointer = { x: 0, y: 0 };
    const onPointerMove = (event: PointerEvent) => {
      pointer.x = (event.clientX / window.innerWidth - 0.5) * 0.22;
      pointer.y = (event.clientY / window.innerHeight - 0.5) * -0.16;
    };
    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    resize();

    const clock = new THREE.Clock();
    let frame = 0;
    const render = () => {
      const elapsed = clock.getElapsedTime();
      if (!document.hidden) {
        points.rotation.y = elapsed * 0.012;
        points.rotation.x = Math.sin(elapsed * 0.08) * 0.035;
        wire.rotation.x = elapsed * 0.035;
        wire.rotation.y = elapsed * 0.055;
        camera.position.x += (pointer.x - camera.position.x) * 0.018;
        camera.position.y += (pointer.y - camera.position.y) * 0.018;
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
      }
      frame = window.requestAnimationFrame(render);
    };
    frame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      resizeObserver.disconnect();
      pointGeometry.dispose();
      pointMaterial.dispose();
      lineGeometry.dispose();
      solidGeometry.dispose();
      lineMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} className="ambient-scene" aria-hidden="true" />;
}
