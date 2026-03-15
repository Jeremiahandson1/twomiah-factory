/* ═══════════════════════════════════════════════════════════════
   CUTTING-EDGE INTERACTIONS
   Smoke particles, magnetic buttons, 3D tilt, stat counters,
   text split, quick-view modal, loyalty ring, dark mode,
   open/closed indicator, scroll progress.
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── SCROLL PROGRESS BAR ──────────────────────────────────────
  function initScrollProgress() {
    var bar = document.querySelector('.scroll-progress');
    if (!bar) return;
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (!ticking) {
        requestAnimationFrame(function () {
          var h = document.documentElement.scrollHeight - window.innerHeight;
          bar.style.width = h > 0 ? (window.scrollY / h * 100) + '%' : '0%';
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  }

  // ── DARK MODE TOGGLE ─────────────────────────────────────────
  function initDarkMode() {
    var toggle = document.querySelector('.dark-mode-toggle');
    if (!toggle) return;
    var saved = localStorage.getItem('theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
    toggle.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme');
      var next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
    });
  }

  // ── LIVE OPEN/CLOSED INDICATOR ───────────────────────────────
  function initLiveStatus() {
    var el = document.querySelector('.live-status');
    if (!el) return;
    var hours = el.getAttribute('data-hours');
    if (!hours) return;
    try {
      var schedule = JSON.parse(hours);
      var now = new Date();
      var days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      var today = schedule[days[now.getDay()]];
      if (today && today.open && today.close) {
        var currentMinutes = now.getHours() * 60 + now.getMinutes();
        var parts = today.open.split(':');
        var openMin = parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
        parts = today.close.split(':');
        var closeMin = parseInt(parts[0]) * 60 + parseInt(parts[1] || 0);
        var isOpen = currentMinutes >= openMin && currentMinutes < closeMin;
        el.classList.add(isOpen ? 'open' : 'closed');
        el.innerHTML = '<span class="pulse-dot"></span>' + (isOpen ? 'Open Now' : 'Closed');
      } else {
        el.classList.add('closed');
        el.innerHTML = '<span class="pulse-dot"></span>Closed Today';
      }
    } catch (e) {
      el.style.display = 'none';
    }
  }

  // ── TEXT SPLIT ANIMATION ─────────────────────────────────────
  function initTextSplit() {
    document.querySelectorAll('.hero-text-split').forEach(function (el) {
      var text = el.textContent.trim();
      el.innerHTML = '';
      text.split(' ').forEach(function (word, i) {
        var span = document.createElement('span');
        span.className = 'word';
        span.textContent = word;
        span.style.animationDelay = (i * 0.08) + 's';
        el.appendChild(span);
        el.appendChild(document.createTextNode(' '));
      });
    });
  }

  // ── SMOKE / PARTICLE HERO ────────────────────────────────────
  function initSmokeHero() {
    var hero = document.querySelector('.smoke-hero');
    if (!hero) return;

    var canvas = document.createElement('canvas');
    canvas.className = 'smoke-canvas';
    hero.insertBefore(canvas, hero.firstChild);

    var ctx = canvas.getContext('2d');
    var particles = [];
    var maxParticles = 40;

    function resize() {
      canvas.width = hero.offsetWidth;
      canvas.height = hero.offsetHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    function Particle() {
      this.reset();
    }
    Particle.prototype.reset = function () {
      this.x = Math.random() * canvas.width;
      this.y = canvas.height + Math.random() * 50;
      this.size = Math.random() * 60 + 20;
      this.speedY = -(Math.random() * 0.8 + 0.2);
      this.speedX = (Math.random() - 0.5) * 0.5;
      this.opacity = 0;
      this.maxOpacity = Math.random() * 0.15 + 0.05;
      this.fadeIn = true;
      this.life = 0;
      this.maxLife = Math.random() * 300 + 200;
    };
    Particle.prototype.update = function () {
      this.x += this.speedX + Math.sin(this.life * 0.01) * 0.3;
      this.y += this.speedY;
      this.size += 0.15;
      this.life++;
      if (this.fadeIn && this.opacity < this.maxOpacity) {
        this.opacity += 0.002;
        if (this.opacity >= this.maxOpacity) this.fadeIn = false;
      }
      if (this.life > this.maxLife * 0.7) {
        this.opacity -= 0.002;
      }
      if (this.opacity <= 0 || this.life > this.maxLife) {
        this.reset();
      }
    };
    Particle.prototype.draw = function () {
      ctx.save();
      ctx.globalAlpha = this.opacity;
      var g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.size);
      g.addColorStop(0, 'rgba(34, 197, 94, 0.3)');
      g.addColorStop(0.5, 'rgba(22, 163, 74, 0.1)');
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    for (var i = 0; i < maxParticles; i++) {
      var p = new Particle();
      p.life = Math.random() * p.maxLife;
      particles.push(p);
    }

    var animId;
    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(function (p) { p.update(); p.draw(); });
      animId = requestAnimationFrame(animate);
    }

    // Only animate when visible
    var observer = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) {
        animate();
      } else {
        cancelAnimationFrame(animId);
      }
    }, { threshold: 0.1 });
    observer.observe(hero);
  }

  // ── 3D TILT CARDS ────────────────────────────────────────────
  function initTiltCards() {
    document.querySelectorAll('.tilt-card').forEach(function (card) {
      card.addEventListener('mousemove', function (e) {
        var rect = card.getBoundingClientRect();
        var x = (e.clientX - rect.left) / rect.width;
        var y = (e.clientY - rect.top) / rect.height;
        var tiltX = (0.5 - y) * 15;
        var tiltY = (x - 0.5) * 15;
        card.style.transform = 'perspective(800px) rotateX(' + tiltX + 'deg) rotateY(' + tiltY + 'deg)';

        // Move shine overlay
        var shine = card.querySelector('.tilt-shine');
        if (shine) {
          shine.style.background = 'radial-gradient(circle at ' + (x * 100) + '% ' + (y * 100) + '%, rgba(255,255,255,0.3), transparent 60%)';
        }
      });
      card.addEventListener('mouseleave', function () {
        card.style.transform = 'perspective(800px) rotateX(0) rotateY(0)';
      });
    });
  }

  // ── MAGNETIC BUTTONS ─────────────────────────────────────────
  function initMagneticButtons() {
    document.querySelectorAll('.magnetic-btn').forEach(function (btn) {
      btn.addEventListener('mousemove', function (e) {
        var rect = btn.getBoundingClientRect();
        var x = e.clientX - rect.left - rect.width / 2;
        var y = e.clientY - rect.top - rect.height / 2;
        btn.style.transform = 'translate(' + (x * 0.3) + 'px, ' + (y * 0.3) + 'px)';
        var text = btn.querySelector('.btn-text');
        if (text) {
          text.style.transform = 'translate(' + (x * 0.15) + 'px, ' + (y * 0.15) + 'px)';
        }
      });
      btn.addEventListener('mouseleave', function () {
        btn.style.transform = 'translate(0, 0)';
        var text = btn.querySelector('.btn-text');
        if (text) text.style.transform = 'translate(0, 0)';
      });
    });
  }

  // ── ANIMATED STAT COUNTERS ───────────────────────────────────
  function initStatCounters() {
    var counters = document.querySelectorAll('.stat-counter');
    if (!counters.length) return;

    var observed = new Set();
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !observed.has(entry.target)) {
          observed.add(entry.target);
          animateCounter(entry.target);
        }
      });
    }, { threshold: 0.3 });

    counters.forEach(function (c) { observer.observe(c); });
  }

  function animateCounter(el) {
    var target = parseFloat(el.getAttribute('data-target') || el.textContent);
    var suffix = el.getAttribute('data-suffix') || '';
    var prefix = el.getAttribute('data-prefix') || '';
    var decimals = (el.getAttribute('data-decimals') || '0') | 0;
    var duration = 2000;
    var start = 0;
    var startTime = null;

    function step(ts) {
      if (!startTime) startTime = ts;
      var progress = Math.min((ts - startTime) / duration, 1);
      // Ease out cubic
      var eased = 1 - Math.pow(1 - progress, 3);
      var current = start + (target - start) * eased;
      el.textContent = prefix + current.toFixed(decimals) + suffix;
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ── STAGGER GRID REVEAL (fallback for no scroll-driven) ─────
  function initStaggerGrid() {
    if (CSS.supports && CSS.supports('animation-timeline', 'view()')) return;
    var grids = document.querySelectorAll('.stagger-grid');
    if (!grids.length) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var children = entry.target.children;
          for (var i = 0; i < children.length; i++) {
            (function (child, delay) {
              setTimeout(function () { child.classList.add('visible'); }, delay);
            })(children[i], i * 100);
          }
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    grids.forEach(function (g) { observer.observe(g); });
  }

  // ── SCROLL REVEAL FALLBACK ───────────────────────────────────
  function initScrollRevealFallback() {
    if (CSS.supports && CSS.supports('animation-timeline', 'view()')) return;
    var items = document.querySelectorAll('.scroll-reveal, .scroll-slide-left, .scroll-slide-right, .scroll-scale');
    if (!items.length) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

    items.forEach(function (el) { observer.observe(el); });
  }

  // ── QUICK VIEW MODAL ────────────────────────────────────────
  function initQuickView() {
    var overlay = document.getElementById('quick-view-overlay');
    if (!overlay) return;

    // Open
    document.addEventListener('click', function (e) {
      var trigger = e.target.closest('[data-quick-view]');
      if (!trigger) return;
      e.preventDefault();
      var data = trigger.getAttribute('data-quick-view');
      try {
        var product = JSON.parse(data);
        populateQuickView(product);
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
      } catch (err) { /* ignore */ }
    });

    // Close
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.closest('.quick-view-close')) {
        overlay.classList.remove('active');
        document.body.style.overflow = '';
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('active')) {
        overlay.classList.remove('active');
        document.body.style.overflow = '';
      }
    });
  }

  function populateQuickView(p) {
    var modal = document.querySelector('.quick-view-modal');
    if (!modal) return;

    var name = modal.querySelector('.qv-name');
    var category = modal.querySelector('.qv-category');
    var price = modal.querySelector('.qv-price');
    var strain = modal.querySelector('.qv-strain');
    var thc = modal.querySelector('.qv-thc');
    var cbd = modal.querySelector('.qv-cbd');
    var desc = modal.querySelector('.qv-desc');
    var img = modal.querySelector('.qv-img');
    var effects = modal.querySelector('.qv-effects');
    var terpenes = modal.querySelector('.qv-terpenes');

    if (name) name.textContent = p.name || '';
    if (category) category.textContent = p.category || '';
    if (price) price.textContent = '$' + (parseFloat(p.price) || 0).toFixed(2);
    if (strain) {
      strain.textContent = p.strainType || '';
      strain.className = 'qv-strain strain-badge ' + (p.strainType || '').toLowerCase();
    }
    if (thc) thc.textContent = p.thcPercent ? p.thcPercent + '% THC' : '';
    if (cbd) cbd.textContent = p.cbdPercent ? p.cbdPercent + '% CBD' : '';
    if (desc) desc.textContent = p.description || '';
    if (img) img.src = p.imageUrl || '/uploads/product-placeholder.jpg';

    // Effects tags
    if (effects) {
      effects.innerHTML = '';
      (p.effects || []).forEach(function (e) {
        var tag = document.createElement('span');
        tag.className = 'effect-tag';
        tag.textContent = e;
        effects.appendChild(tag);
      });
    }

    // Simple terpene visualization
    if (terpenes && p.terpenes && p.terpenes.length) {
      drawTerpeneChart(terpenes, p.terpenes);
    }
  }

  function drawTerpeneChart(container, terpenes) {
    container.innerHTML = '';
    var size = 140;
    var cx = size / 2, cy = size / 2, r = size / 2 - 15;

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);

    var n = terpenes.length;
    if (n < 3) return;

    // Background polygon
    var bgPoints = [];
    for (var i = 0; i < n; i++) {
      var angle = (Math.PI * 2 * i / n) - Math.PI / 2;
      bgPoints.push((cx + r * Math.cos(angle)).toFixed(1) + ',' + (cy + r * Math.sin(angle)).toFixed(1));
    }
    var bgPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    bgPoly.setAttribute('points', bgPoints.join(' '));
    bgPoly.setAttribute('fill', 'rgba(34,197,94,0.08)');
    bgPoly.setAttribute('stroke', 'rgba(34,197,94,0.2)');
    bgPoly.setAttribute('stroke-width', '1');
    svg.appendChild(bgPoly);

    // Data polygon
    var dataPoints = [];
    for (var j = 0; j < n; j++) {
      var a = (Math.PI * 2 * j / n) - Math.PI / 2;
      var val = Math.min(terpenes[j].value / 100, 1);
      dataPoints.push((cx + r * val * Math.cos(a)).toFixed(1) + ',' + (cy + r * val * Math.sin(a)).toFixed(1));
    }
    var dataPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    dataPoly.setAttribute('points', dataPoints.join(' '));
    dataPoly.setAttribute('fill', 'rgba(34,197,94,0.25)');
    dataPoly.setAttribute('stroke', '#16a34a');
    dataPoly.setAttribute('stroke-width', '2');
    svg.appendChild(dataPoly);

    // Labels
    for (var k = 0; k < n; k++) {
      var la = (Math.PI * 2 * k / n) - Math.PI / 2;
      var lx = cx + (r + 12) * Math.cos(la);
      var ly = cy + (r + 12) * Math.sin(la);
      var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', lx);
      text.setAttribute('y', ly);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('font-size', '8');
      text.setAttribute('fill', '#666');
      text.textContent = terpenes[k].name;
      svg.appendChild(text);
    }

    container.appendChild(svg);
  }

  // ── LOYALTY PROGRESS RING ───────────────────────────────────
  function initProgressRings() {
    document.querySelectorAll('.progress-ring').forEach(function (svg) {
      var circle = svg.querySelector('.progress-ring__circle');
      if (!circle) return;
      var radius = parseFloat(circle.getAttribute('r'));
      var circumference = 2 * Math.PI * radius;
      var percent = parseFloat(svg.getAttribute('data-percent') || 0);

      circle.style.strokeDasharray = circumference;
      circle.style.strokeDashoffset = circumference;

      var observer = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) {
          var offset = circumference - (percent / 100) * circumference;
          circle.style.strokeDashoffset = offset;
          observer.unobserve(svg);
        }
      }, { threshold: 0.3 });
      observer.observe(svg);
    });
  }

  // ── AGE GATE PARTICLES ──────────────────────────────────────
  function initAgeGateParticles() {
    var container = document.querySelector('.ag-particles');
    if (!container) return;

    for (var i = 0; i < 30; i++) {
      var p = document.createElement('div');
      p.className = 'particle';
      p.style.left = Math.random() * 100 + '%';
      p.style.width = p.style.height = (Math.random() * 6 + 2) + 'px';
      p.style.background = 'rgba(34, 197, 94, ' + (Math.random() * 0.4 + 0.1) + ')';
      p.style.animationDuration = (Math.random() * 15 + 10) + 's';
      p.style.animationDelay = (Math.random() * 10) + 's';
      container.appendChild(p);
    }
  }

  // ── VARIABLE FONT WEIGHT ON SCROLL ──────────────────────────
  function initVariableFontHero() {
    var el = document.querySelector('.variable-font-hero');
    if (!el) return;
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (!ticking) {
        requestAnimationFrame(function () {
          var rect = el.getBoundingClientRect();
          var progress = Math.max(0, Math.min(1, 1 - rect.top / window.innerHeight));
          var weight = 300 + progress * 600;
          el.style.setProperty('--hero-weight', Math.round(weight));
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  }

  // ── INIT ─────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    initDarkMode();
    initScrollProgress();
    initLiveStatus();
    initTextSplit();
    initSmokeHero();
    initTiltCards();
    initMagneticButtons();
    initStatCounters();
    initStaggerGrid();
    initScrollRevealFallback();
    initQuickView();
    initProgressRings();
    initAgeGateParticles();
    initVariableFontHero();
  });

})();
