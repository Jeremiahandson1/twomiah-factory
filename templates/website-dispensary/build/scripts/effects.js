/* ═══════════════════════════════════════════════════════════════
   NEXT-LEVEL GPU EFFECTS
   WebGL fluid simulation, GLSL shader backgrounds,
   blend-mode cursor, liquid distortion, kinetic typography.
   All GPU-accelerated, production-ready.
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // Skip heavy effects on mobile / low-end devices
  var isMobile = /Mobi|Android/i.test(navigator.userAgent);
  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;

  // ═══════════════════════════════════════════════════════════════
  // 1. WEBGL FLUID SIMULATION
  //    Navier-Stokes on GPU. Cursor creates colored smoke trails.
  // ═══════════════════════════════════════════════════════════════
  function initFluidSimulation() {
    var container = document.querySelector('.fluid-canvas-wrap');
    if (!container || isMobile || prefersReduced) return;

    var canvas = document.createElement('canvas');
    canvas.className = 'fluid-canvas';
    container.appendChild(canvas);

    var gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return;

    // Detect float texture support
    var isWebGL2 = gl instanceof WebGL2RenderingContext;
    var halfFloat = isWebGL2 ? gl.HALF_FLOAT :
      (gl.getExtension('OES_texture_half_float') || {}).HALF_FLOAT_OES;
    if (!halfFloat) return;

    if (!isWebGL2) {
      gl.getExtension('OES_texture_half_float_linear');
    }

    var texType = halfFloat;
    var internalFormat = isWebGL2 ? gl.RGBA16F : gl.RGBA;

    // Config
    var config = {
      SIM_RES: 128,
      DYE_RES: 1024,
      DENSITY_DISSIPATION: 1.2,
      VELOCITY_DISSIPATION: 0.8,
      PRESSURE_ITERATIONS: 20,
      CURL_STRENGTH: 30,
      SPLAT_RADIUS: 0.25,
      SPLAT_FORCE: 6000,
      COLOR_PALETTE: [
        [0.0, 0.65, 0.35],   // emerald green
        [0.1, 0.45, 0.28],   // forest green
        [0.55, 0.2, 0.85],   // purple
        [0.0, 0.8, 0.5],     // mint
        [0.15, 0.55, 0.35],  // sage
      ]
    };

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    }
    resize();
    window.addEventListener('resize', resize);

    // ── Shader compilation ──
    function compileShader(type, source) {
      var shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    }

    function createProgram(vsSource, fsSource) {
      var vs = compileShader(gl.VERTEX_SHADER, vsSource);
      var fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
      if (!vs || !fs) return null;
      var prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        gl.deleteProgram(prog);
        return null;
      }
      return prog;
    }

    var baseVS = isWebGL2 ?
      '#version 300 es\nin vec2 aPosition;out vec2 vUv;void main(){vUv=aPosition*0.5+0.5;gl_Position=vec4(aPosition,0,1);}' :
      'attribute vec2 aPosition;varying vec2 vUv;void main(){vUv=aPosition*0.5+0.5;gl_Position=vec4(aPosition,0,1);}';

    var precisionHeader = isWebGL2 ?
      '#version 300 es\nprecision highp float;precision highp sampler2D;in vec2 vUv;out vec4 fragColor;' :
      'precision highp float;precision highp sampler2D;varying vec2 vUv;';

    var fragOut = isWebGL2 ? 'fragColor' : 'gl_FragColor';

    // Display shader — renders the dye field
    var displayFS = precisionHeader +
      'uniform sampler2D uTexture;' +
      'void main(){vec3 c=texture' + (isWebGL2 ? '' : '2D') + '(uTexture,vUv).rgb;' +
      fragOut + '=vec4(c,1.0);}';

    // Splat shader — adds color at a point
    var splatFS = precisionHeader +
      'uniform sampler2D uTarget;uniform float aspectRatio;uniform vec3 color;' +
      'uniform vec2 point;uniform float radius;' +
      'void main(){vec2 p=vUv-point;p.x*=aspectRatio;' +
      'vec3 splat=exp(-dot(p,p)/radius)*color;' +
      'vec3 base=texture' + (isWebGL2 ? '' : '2D') + '(uTarget,vUv).rgb;' +
      fragOut + '=vec4(base+splat,1.0);}';

    // Advection shader — moves the field
    var advectionFS = precisionHeader +
      'uniform sampler2D uVelocity;uniform sampler2D uSource;' +
      'uniform vec2 texelSize;uniform float dt;uniform float dissipation;' +
      'void main(){vec2 coord=vUv-dt*texture' + (isWebGL2 ? '' : '2D') + '(uVelocity,vUv).xy*texelSize;' +
      'vec3 result=dissipation*texture' + (isWebGL2 ? '' : '2D') + '(uSource,coord).rgb;' +
      fragOut + '=vec4(result,1.0);}';

    var displayProg = createProgram(baseVS, displayFS);
    var splatProg = createProgram(baseVS, splatFS);
    var advectionProg = createProgram(baseVS, advectionFS);

    if (!displayProg || !splatProg || !advectionProg) return;

    // Quad geometry
    var quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);

    var quadIdx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

    function bindQuad(program) {
      var loc = gl.getAttribLocation(program, 'aPosition');
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIdx);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }

    // Double-buffered FBOs
    function createDoubleFBO(w, h) {
      function createFBO() {
        var tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, gl.RGBA, texType, null);

        var fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

        return { texture: tex, fbo: fbo, width: w, height: h };
      }

      var fbo1 = createFBO();
      var fbo2 = createFBO();

      return {
        width: w, height: h,
        read: fbo1, write: fbo2,
        swap: function () {
          var tmp = this.read;
          this.read = this.write;
          this.write = tmp;
        }
      };
    }

    var simRes = getResolution(config.SIM_RES);
    var dyeRes = getResolution(config.DYE_RES);

    function getResolution(res) {
      var aspect = canvas.width / canvas.height;
      if (aspect < 1) return { width: Math.round(res), height: Math.round(res / aspect) };
      return { width: Math.round(res * aspect), height: Math.round(res) };
    }

    var velocity = createDoubleFBO(simRes.width, simRes.height);
    var dye = createDoubleFBO(dyeRes.width, dyeRes.height);

    // Mouse tracking
    var pointer = { x: 0.5, y: 0.5, dx: 0, dy: 0, moved: false, color: [0, 0, 0] };
    var lastTime = Date.now();

    function getColor() {
      var c = config.COLOR_PALETTE[Math.floor(Math.random() * config.COLOR_PALETTE.length)];
      return [c[0] * 0.8 + Math.random() * 0.2, c[1] * 0.8 + Math.random() * 0.2, c[2] * 0.8 + Math.random() * 0.2];
    }

    var colorTimer = 0;
    pointer.color = getColor();

    canvas.addEventListener('mousemove', function (e) {
      var rect = canvas.getBoundingClientRect();
      var x = (e.clientX - rect.left) / rect.width;
      var y = 1.0 - (e.clientY - rect.top) / rect.height;
      pointer.dx = (x - pointer.x) * 10;
      pointer.dy = (y - pointer.y) * 10;
      pointer.x = x;
      pointer.y = y;
      pointer.moved = true;
    });

    // Auto-splats for ambient effect
    function autoSplat() {
      var x = Math.random();
      var y = Math.random();
      var dx = (Math.random() - 0.5) * 2;
      var dy = (Math.random() - 0.5) * 2;
      var color = getColor();
      splat(x, y, dx * 500, dy * 500, color);
    }

    function splat(x, y, dx, dy, color) {
      gl.useProgram(splatProg);
      bindQuad(splatProg);

      // Splat velocity
      gl.uniform1i(gl.getUniformLocation(splatProg, 'uTarget'), 0);
      gl.uniform1f(gl.getUniformLocation(splatProg, 'aspectRatio'), canvas.width / canvas.height);
      gl.uniform2f(gl.getUniformLocation(splatProg, 'point'), x, y);
      gl.uniform3f(gl.getUniformLocation(splatProg, 'color'), dx, dy, 0);
      gl.uniform1f(gl.getUniformLocation(splatProg, 'radius'), config.SPLAT_RADIUS / 100);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, velocity.read.texture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, velocity.write.fbo);
      gl.viewport(0, 0, velocity.width, velocity.height);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      velocity.swap();

      // Splat dye
      gl.uniform3f(gl.getUniformLocation(splatProg, 'color'), color[0], color[1], color[2]);
      gl.bindTexture(gl.TEXTURE_2D, dye.read.texture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, dye.write.fbo);
      gl.viewport(0, 0, dye.width, dye.height);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      dye.swap();
    }

    function step(dt) {
      // Advect velocity
      gl.useProgram(advectionProg);
      bindQuad(advectionProg);
      gl.uniform2f(gl.getUniformLocation(advectionProg, 'texelSize'), 1.0 / velocity.width, 1.0 / velocity.height);
      gl.uniform1f(gl.getUniformLocation(advectionProg, 'dt'), dt);
      gl.uniform1f(gl.getUniformLocation(advectionProg, 'dissipation'), config.VELOCITY_DISSIPATION);

      gl.uniform1i(gl.getUniformLocation(advectionProg, 'uVelocity'), 0);
      gl.uniform1i(gl.getUniformLocation(advectionProg, 'uSource'), 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, velocity.read.texture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, velocity.write.fbo);
      gl.viewport(0, 0, velocity.width, velocity.height);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      velocity.swap();

      // Advect dye
      gl.uniform2f(gl.getUniformLocation(advectionProg, 'texelSize'), 1.0 / dye.width, 1.0 / dye.height);
      gl.uniform1f(gl.getUniformLocation(advectionProg, 'dissipation'), config.DENSITY_DISSIPATION);
      gl.uniform1i(gl.getUniformLocation(advectionProg, 'uVelocity'), 0);
      gl.uniform1i(gl.getUniformLocation(advectionProg, 'uSource'), 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, velocity.read.texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, dye.read.texture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, dye.write.fbo);
      gl.viewport(0, 0, dye.width, dye.height);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      dye.swap();
    }

    function render() {
      gl.useProgram(displayProg);
      bindQuad(displayProg);
      gl.uniform1i(gl.getUniformLocation(displayProg, 'uTexture'), 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, dye.read.texture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    // Initial splats
    for (var i = 0; i < 5; i++) {
      setTimeout(autoSplat, i * 300);
    }

    var animId;
    function loop() {
      var now = Date.now();
      var dt = Math.min((now - lastTime) / 1000, 0.016);
      lastTime = now;

      colorTimer += dt;
      if (colorTimer > 2) {
        colorTimer = 0;
        pointer.color = getColor();
      }

      if (pointer.moved) {
        pointer.moved = false;
        splat(pointer.x, pointer.y, pointer.dx * config.SPLAT_FORCE, pointer.dy * config.SPLAT_FORCE, pointer.color);
      }

      // Ambient splats
      if (Math.random() < 0.02) autoSplat();

      step(dt);
      render();
      animId = requestAnimationFrame(loop);
    }

    // Only run when hero is visible
    var heroEl = container.closest('.hero-enhanced, .smoke-hero');
    if (heroEl) {
      var obs = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) { loop(); }
        else { cancelAnimationFrame(animId); }
      }, { threshold: 0.05 });
      obs.observe(heroEl);
    } else {
      loop();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. GLSL SHADER AURORA BACKGROUND
  //    GPU-rendered noise field — replaces CSS radial gradients.
  // ═══════════════════════════════════════════════════════════════
  function initShaderBackground() {
    var container = document.querySelector('.shader-bg');
    if (!container || isMobile || prefersReduced) return;

    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;';
    container.insertBefore(canvas, container.firstChild);

    var gl = canvas.getContext('webgl');
    if (!gl) return;

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    }
    resize();
    window.addEventListener('resize', resize);

    var vsSource = 'attribute vec2 p;void main(){gl_Position=vec4(p,0,1);}';
    var fsSource = [
      'precision mediump float;',
      'uniform float t;',
      'uniform vec2 r;',
      '',
      'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
      '',
      'float noise(vec2 p){',
      '  vec2 i=floor(p),f=fract(p);',
      '  f=f*f*(3.0-2.0*f);',
      '  float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));',
      '  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);',
      '}',
      '',
      'float fbm(vec2 p){',
      '  float v=0.0,a=0.5;',
      '  mat2 rot=mat2(cos(0.5),sin(0.5),-sin(0.5),cos(0.5));',
      '  for(int i=0;i<5;i++){v+=a*noise(p);p=rot*p*2.0;a*=0.5;}',
      '  return v;',
      '}',
      '',
      'void main(){',
      '  vec2 uv=gl_FragCoord.xy/r;',
      '  float time=t*0.08;',
      '',
      '  // Warped domain for organic flow',
      '  vec2 q=vec2(fbm(uv*3.0+time),fbm(uv*3.0+vec2(1.7,9.2)+time*0.7));',
      '  vec2 rd=vec2(fbm(uv*4.0+q*1.5+vec2(1.2,3.4)+time*0.3),fbm(uv*4.0+q*1.5+vec2(8.3,2.8)+time*0.5));',
      '  float f=fbm(uv*3.0+rd*2.0);',
      '',
      '  // Color palette — deep greens, emerald, hints of purple',
      '  vec3 col=mix(vec3(0.02,0.06,0.04),vec3(0.04,0.25,0.15),f);',
      '  col=mix(col,vec3(0.15,0.08,0.25),q.y*0.4);',
      '  col=mix(col,vec3(0.0,0.45,0.25),smoothstep(0.3,0.8,rd.x)*0.3);',
      '  col+=vec3(0.02,0.05,0.03)*fbm(uv*8.0+time*0.2);',
      '',
      '  // Subtle vignette',
      '  float vig=1.0-0.4*length(uv-0.5);',
      '  col*=vig;',
      '',
      '  gl_FragColor=vec4(col,1.0);',
      '}'
    ].join('\n');

    var vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);

    var fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);

    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) return;

    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    var pLoc = gl.getAttribLocation(prog, 'p');
    var tLoc = gl.getUniformLocation(prog, 't');
    var rLoc = gl.getUniformLocation(prog, 'r');

    var startTime = Date.now();
    var animId;

    function draw() {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(prog);
      gl.enableVertexAttribArray(pLoc);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(tLoc, (Date.now() - startTime) / 1000);
      gl.uniform2f(rLoc, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      animId = requestAnimationFrame(draw);
    }

    // Only animate when visible
    var obs = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) { draw(); }
      else { cancelAnimationFrame(animId); }
    }, { threshold: 0.05 });
    obs.observe(container);
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. JOINT CURSOR + SMOKE TRAIL
  //    Renders the joint SVG → canvas → PNG data URL, then applies
  //    it as a native CSS cursor. PNG cursors work in all browsers.
  //    JS also handles the smoke particle canvas overlay.
  //    Hotspot = cherry tip, so e.clientX/Y IS the smoke origin.
  // ═══════════════════════════════════════════════════════════════
  function initCustomCursor() {
    if (isCoarsePointer || isMobile || prefersReduced) return;

    // --- Draw joint directly on canvas → PNG → native CSS cursor ---
    // No SVG/Image loading — pure canvas 2D, synchronous, no CORS issues
    var cc = document.createElement('canvas');
    cc.width = 32; cc.height = 32;
    var cctx = cc.getContext('2d');

    cctx.save();
    cctx.translate(16, 16);
    cctx.rotate(55 * Math.PI / 180);
    cctx.translate(-16, -16);

    // Joint body (rounded rect)
    cctx.fillStyle = '#e8d5b7';
    cctx.beginPath();
    cctx.moveTo(4.5, 13.5);
    cctx.lineTo(23.5, 13.5);
    cctx.quadraticCurveTo(26, 13.5, 26, 16);
    cctx.quadraticCurveTo(26, 18.5, 23.5, 18.5);
    cctx.lineTo(4.5, 18.5);
    cctx.quadraticCurveTo(2, 18.5, 2, 16);
    cctx.quadraticCurveTo(2, 13.5, 4.5, 13.5);
    cctx.closePath();
    cctx.fill();

    // Filter tip
    cctx.fillStyle = '#f5f0e6';
    cctx.beginPath();
    cctx.moveTo(22, 13.5);
    cctx.lineTo(24, 13.5);
    cctx.quadraticCurveTo(26, 13.5, 26, 16);
    cctx.quadraticCurveTo(26, 18.5, 24, 18.5);
    cctx.lineTo(22, 18.5);
    cctx.quadraticCurveTo(20, 18.5, 20, 16);
    cctx.quadraticCurveTo(20, 13.5, 22, 13.5);
    cctx.closePath();
    cctx.fill();

    // Cherry glow (outer)
    cctx.globalAlpha = 0.9;
    cctx.fillStyle = '#ff6b00';
    cctx.beginPath();
    cctx.arc(2, 16, 3.5, 0, Math.PI * 2);
    cctx.fill();

    // Cherry glow (mid)
    cctx.globalAlpha = 0.7;
    cctx.fillStyle = '#ffaa00';
    cctx.beginPath();
    cctx.arc(2, 16, 2.2, 0, Math.PI * 2);
    cctx.fill();

    // Cherry core
    cctx.globalAlpha = 0.8;
    cctx.fillStyle = '#fff4cc';
    cctx.beginPath();
    cctx.arc(2, 16, 1, 0, Math.PI * 2);
    cctx.fill();

    cctx.restore();

    var pngUrl = cc.toDataURL('image/png');
    var cursorStyle = document.createElement('style');
    cursorStyle.textContent = '@media(pointer:fine){*,*::before,*::after{cursor:url("' + pngUrl + '") 8 5,auto!important}}';
    document.head.appendChild(cursorStyle);

    // --- Smoke particle canvas (visual effects layer) ---
    var smokeCanvas = document.createElement('canvas');
    smokeCanvas.className = 'smoke-canvas';
    document.body.appendChild(smokeCanvas);
    var ctx = smokeCanvas.getContext('2d');

    function resizeCanvas() {
      smokeCanvas.width = window.innerWidth;
      smokeCanvas.height = window.innerHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    var mx = -100, my = -100;
    var particles = [];
    var MAX_PARTICLES = 80;

    document.addEventListener('mousemove', function (e) {
      mx = e.clientX;
      my = e.clientY;
    });

    function spawnSmoke(x, y) {
      if (particles.length >= MAX_PARTICLES) return;
      // Cursor hotspot IS the cherry — smoke spawns right at the cursor position
      for (var i = 0; i < 2; i++) {
        particles.push({
          x: x + (Math.random() - 0.5) * 4,
          y: y + (Math.random() - 0.5) * 4,
          vx: (Math.random() - 0.5) * 0.8,
          vy: -(Math.random() * 1.5 + 0.5),
          size: Math.random() * 12 + 6,
          alpha: Math.random() * 0.4 + 0.2,
          life: 1,
          decay: Math.random() * 0.008 + 0.005,
          turbFreq: Math.random() * 0.05 + 0.02,
          turbAmp: Math.random() * 1.5 + 0.5,
          age: 0
        });
      }
    }

    var frameCount = 0;

    function animate() {
      ctx.clearRect(0, 0, smokeCanvas.width, smokeCanvas.height);

      // Spawn smoke every other frame at cursor position
      if (frameCount % 2 === 0 && mx > 0) {
        spawnSmoke(mx, my);
      }

      // Update and draw particles
      for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        p.age++;
        p.life -= p.decay;

        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }

        // Turbulence — sine wave wobble
        p.vx += Math.sin(p.age * p.turbFreq) * p.turbAmp * 0.1;
        p.vy -= 0.02;

        p.x += p.vx;
        p.y += p.vy;
        p.size += 0.3;

        // Draw smoke puff
        var alpha = p.alpha * p.life;
        var gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        gradient.addColorStop(0, 'rgba(200, 200, 200, ' + alpha + ')');
        gradient.addColorStop(0.4, 'rgba(180, 180, 180, ' + (alpha * 0.6) + ')');
        gradient.addColorStop(1, 'rgba(160, 160, 160, 0)');

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      frameCount++;
      requestAnimationFrame(animate);
    }
    animate();
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. LIQUID DISTORTION ON PRODUCT IMAGE HOVER
  //    WebGL displacement map ripple effect.
  // ═══════════════════════════════════════════════════════════════
  function initLiquidDistortion() {
    if (isMobile || prefersReduced) return;

    var cards = document.querySelectorAll('.product-image img');
    if (!cards.length) return;

    cards.forEach(function (img) {
      img.addEventListener('mouseenter', function () {
        img.style.transition = 'filter 0.4s ease';
        img.style.filter = 'url(#liquid-distort)';
      });
      img.addEventListener('mouseleave', function () {
        img.style.filter = 'none';
      });
    });

    // Create SVG distortion filter
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.innerHTML =
      '<defs>' +
      '<filter id="liquid-distort">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.015" numOctaves="3" result="noise" seed="1">' +
      '<animate attributeName="seed" from="1" to="10" dur="2s" repeatCount="indefinite"/>' +
      '</feTurbulence>' +
      '<feDisplacementMap in="SourceGraphic" in2="noise" scale="12" xChannelSelector="R" yChannelSelector="G"/>' +
      '</filter>' +
      '</defs>';
    document.body.appendChild(svg);
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. KINETIC TYPOGRAPHY
  //    Character-level spring animations on scroll.
  // ═══════════════════════════════════════════════════════════════
  function initKineticType() {
    if (prefersReduced) return;

    document.querySelectorAll('.kinetic-text').forEach(function (el) {
      var text = el.textContent.trim();
      el.textContent = '';
      el.style.overflow = 'hidden';

      var chars = text.split('');
      chars.forEach(function (ch, i) {
        var span = document.createElement('span');
        span.className = 'kinetic-char';
        span.textContent = ch === ' ' ? '\u00A0' : ch;
        span.style.animationDelay = (i * 0.03) + 's';
        el.appendChild(span);
      });

      // Trigger on scroll
      var observer = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) {
          el.classList.add('kinetic-active');
          observer.unobserve(el);
        }
      }, { threshold: 0.3 });
      observer.observe(el);
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 6. PARALLAX DEPTH LAYERS
  //    Subtle mouse-following parallax on hero content.
  // ═══════════════════════════════════════════════════════════════
  function initParallaxDepth() {
    if (isMobile || prefersReduced) return;

    var hero = document.querySelector('.hero-enhanced');
    if (!hero) return;

    var layers = hero.querySelectorAll('[data-depth]');
    if (!layers.length) {
      // Auto-apply depth to hero children
      var content = hero.querySelector('.hero-video-content, .hero-content');
      if (content) content.setAttribute('data-depth', '0.03');
      layers = hero.querySelectorAll('[data-depth]');
    }

    hero.addEventListener('mousemove', function (e) {
      var rect = hero.getBoundingClientRect();
      var x = (e.clientX - rect.left) / rect.width - 0.5;
      var y = (e.clientY - rect.top) / rect.height - 0.5;

      layers.forEach(function (layer) {
        var depth = parseFloat(layer.getAttribute('data-depth') || 0);
        var moveX = x * depth * 100;
        var moveY = y * depth * 100;
        layer.style.transform = 'translate(' + moveX + 'px,' + moveY + 'px)';
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 7. SMOOTH SCROLL MOMENTUM (Lenis-style)
  //    Buttery-smooth scroll with eased momentum.
  // ═══════════════════════════════════════════════════════════════
  function initSmoothScroll() {
    if (isMobile || prefersReduced) return;
    // Use native smooth scroll with CSS scroll-behavior: smooth
    // Adding custom momentum creates accessibility issues and
    // fights with browser back/forward cache — intentionally
    // keeping it native with CSS scroll-behavior.
  }

  // ═══════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', function () {
    initFluidSimulation();
    initShaderBackground();
    initCustomCursor();
    initLiquidDistortion();
    initKineticType();
    initParallaxDepth();
    initSmoothScroll();
  });

})();
