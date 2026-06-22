import { useEffect, useRef } from "react";

export function NeuralBranchNetwork() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const host = canvas.parentElement;
    if (!ctx || !host) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let raf = 0;

    const mouse = { x: -9999, y: -9999, sx: -9999, sy: -9999, active: false };

    const NODE_COUNT = 54;
    const MAX_DIST = 165;
    const MOUSE_DIST = 220;

    type Node = {
      x: number; y: number; vx: number; vy: number;
      baseR: number; hub: boolean; tw: number; twSpeed: number;
    };
    type Pulse = { ax: number; ay: number; bx: number; by: number; t: number; speed: number };

    let nodes: Node[] = [];
    const pulses: Pulse[] = [];

    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    const initNodes = () => {
      nodes = [];
      for (let i = 0; i < NODE_COUNT; i++) {
        const hub = i % 6 === 0;
        nodes.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: rand(-0.18, 0.18),
          vy: rand(-0.18, 0.18),
          baseR: hub ? rand(2.6, 3.4) : rand(1.1, 1.9),
          hub,
          tw: Math.random() * Math.PI * 2,
          twSpeed: rand(0.6, 1.4),
        });
      }
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initNodes();
    };

    const maybeSpawnPulse = (a: Node, b: Node, strength: number) => {
      if (Math.random() < 0.0016 * strength) {
        pulses.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, t: 0, speed: rand(0.012, 0.026) });
      }
    };

    let lastT = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(2.4, (now - lastT) / 16.67);
      lastT = now;

      mouse.sx += (mouse.x - mouse.sx) * 0.12;
      mouse.sy += (mouse.y - mouse.sy) * 0.12;

      ctx.clearRect(0, 0, width, height);

      for (const n of nodes) {
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        n.tw += 0.02 * n.twSpeed * dt;

        if (n.x < -20) n.x = width + 20;
        if (n.x > width + 20) n.x = -20;
        if (n.y < -20) n.y = height + 20;
        if (n.y > height + 20) n.y = -20;

        if (mouse.active) {
          const dx = mouse.x - n.x;
          const dy = mouse.y - n.y;
          const d = Math.hypot(dx, dy);
          if (d < MOUSE_DIST && d > 1) {
            const f = (1 - d / MOUSE_DIST) * 0.04;
            n.x += (dx / d) * f * dt;
            n.y += (dy / d) * f * dt;
          }
        }
      }

      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d > MAX_DIST) continue;
          const base = 1 - d / MAX_DIST;

          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const md = Math.hypot(mouse.sx - mx, mouse.sy - my);
          const near = mouse.active ? Math.max(0, 1 - md / MOUSE_DIST) : 0;

          const alpha = base * (0.16 + near * 0.55);
          if (near > 0.05) {
            ctx.strokeStyle = `rgba(${Math.round(96 + near * 150)}, ${Math.round(165 + near * 10)}, ${Math.round(250 - near * 120)}, ${alpha})`;
            ctx.lineWidth = 0.8 + near * 1.1;
          } else {
            ctx.strokeStyle = `rgba(96, 165, 250, ${alpha})`;
            ctx.lineWidth = 0.8;
          }
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();

          maybeSpawnPulse(a, b, base + near * 3);
        }
      }

      if (mouse.active) {
        for (const n of nodes) {
          const dx = mouse.x - n.x;
          const dy = mouse.y - n.y;
          const d = Math.hypot(dx, dy);
          if (d > MOUSE_DIST) continue;
          const a = 1 - d / MOUSE_DIST;
          ctx.strokeStyle = `rgba(249, 115, 22, ${a * 0.5})`;
          ctx.lineWidth = 0.6 + a * 1.1;
          ctx.beginPath();
          ctx.moveTo(mouse.x, mouse.y);
          ctx.lineTo(n.x, n.y);
          ctx.stroke();
        }
      }

      for (let k = pulses.length - 1; k >= 0; k--) {
        const p = pulses[k];
        p.t += p.speed * dt;
        if (p.t >= 1) { pulses.splice(k, 1); continue; }
        const px = p.ax + (p.bx - p.ax) * p.t;
        const py = p.ay + (p.by - p.ay) * p.t;
        const fade = Math.sin(p.t * Math.PI);
        ctx.beginPath();
        ctx.arc(px, py, 1.7, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(125, 211, 252, ${0.9 * fade})`;
        ctx.shadowColor = "rgba(125, 211, 252, 0.9)";
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      for (const n of nodes) {
        const dxm = mouse.sx - n.x;
        const dym = mouse.sy - n.y;
        const dm = Math.hypot(dxm, dym);
        const near = mouse.active ? Math.max(0, 1 - dm / MOUSE_DIST) : 0;
        const twinkle = 0.5 + 0.5 * Math.sin(n.tw);
        const r = n.baseR + near * 1.6 + (n.hub ? twinkle * 0.5 : 0);

        if (n.hub || near > 0.1) {
          const glowR = r + 4 + near * 4;
          const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, glowR);
          const col = n.hub ? "249, 115, 22" : "96, 165, 250";
          g.addColorStop(0, `rgba(${col}, ${0.35 + near * 0.35})`);
          g.addColorStop(1, `rgba(${col}, 0)`);
          ctx.beginPath();
          ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = g;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.hub
          ? `rgba(251, 146, 60, ${0.75 + twinkle * 0.25})`
          : `rgba(147, 197, 253, ${0.45 + twinkle * 0.3 + near * 0.4})`;
        ctx.fill();
      }

      if (mouse.active) {
        const halo = ctx.createRadialGradient(mouse.sx, mouse.sy, 0, mouse.sx, mouse.sy, MOUSE_DIST * 0.8);
        halo.addColorStop(0, "rgba(59, 130, 246, 0.08)");
        halo.addColorStop(1, "rgba(59, 130, 246, 0)");
        ctx.fillStyle = halo;
        ctx.fillRect(0, 0, width, height);
      }

      raf = requestAnimationFrame(frame);
    };

    const onMove = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      if (!mouse.active) { mouse.sx = mouse.x; mouse.sy = mouse.y; }
      mouse.active = true;
    };
    const onLeave = () => { mouse.active = false; mouse.x = -9999; mouse.y = -9999; };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);

    if (reduceMotion) {
      frame(performance.now());
      cancelAnimationFrame(raf);
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden="true"
    />
  );
}
