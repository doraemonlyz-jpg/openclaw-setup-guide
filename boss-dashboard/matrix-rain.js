/* Matrix-style data rain — runs in #matrix-canvas behind everything.
 * Low alpha so it doesn't fight the UI. Resizes with the window.
 * ~60fps on M-series; ~30fps on older hardware (rendered with low fps target).
 */
(function () {
  const canvas = document.getElementById("matrix-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  // Charset: katakana half-width + digits + binary + a few cyber glyphs.
  const CHARSET = (
    "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ" +
    "0123456789" +
    "01010101" +
    "<>{}[]/\\|=+-*"
  ).split("");

  const FONT_SIZE = 14;
  let cols = 0;
  let drops = []; // each drop: {y, speed, alpha, char}
  let width = 0, height = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(width / FONT_SIZE);
    drops = new Array(cols).fill(0).map((_, i) => makeDrop(i, true));
  }

  function makeDrop(i, initial) {
    return {
      y: initial ? Math.random() * height : -Math.random() * 200,
      speed: 0.6 + Math.random() * 1.6,   // px per frame multiplier
      alpha: 0.35 + Math.random() * 0.45,
      brightLead: Math.random() < 0.25,    // some drops have a brighter head
      lastChar: pickChar(),
      changeEvery: 2 + Math.floor(Math.random() * 6),
      tick: 0,
    };
  }

  function pickChar() {
    return CHARSET[(Math.random() * CHARSET.length) | 0];
  }

  // Trail effect: paint a translucent black rect every frame so old chars fade.
  let lastFrame = performance.now();
  const TARGET_FPS = 30;
  const FRAME_MS = 1000 / TARGET_FPS;

  function frame(now) {
    if (now - lastFrame >= FRAME_MS) {
      lastFrame = now;

      // Fade prior frame
      ctx.fillStyle = "rgba(5, 8, 16, 0.10)";
      ctx.fillRect(0, 0, width, height);

      ctx.font = `${FONT_SIZE}px 'Share Tech Mono', monospace`;
      ctx.textBaseline = "top";

      for (let i = 0; i < cols; i++) {
        const d = drops[i];
        d.tick++;
        if (d.tick >= d.changeEvery) {
          d.lastChar = pickChar();
          d.tick = 0;
        }
        const x = i * FONT_SIZE;

        // Bright head
        if (d.brightLead) {
          ctx.fillStyle = `rgba(0, 240, 255, ${Math.min(1, d.alpha + 0.3)})`;
          ctx.shadowColor = "#00f0ff";
          ctx.shadowBlur = 6;
        } else {
          ctx.fillStyle = `rgba(57, 255, 20, ${d.alpha})`;
          ctx.shadowColor = "rgba(57, 255, 20, 0.6)";
          ctx.shadowBlur = 2;
        }
        ctx.fillText(d.lastChar, x, d.y);
        ctx.shadowBlur = 0;

        d.y += d.speed * (FONT_SIZE * 0.45);
        if (d.y > height + Math.random() * 200) {
          drops[i] = makeDrop(i, false);
        }
      }
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(frame);
})();
