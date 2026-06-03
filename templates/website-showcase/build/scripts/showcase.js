/* Showcase Engine — progressive enhancement.
   Every block feature-detects and no-ops if its target is absent,
   so this is safe on any page rendered by the template. */
(function () {
  "use strict";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 1. Ambient embers in the hero (or first <section>/<header>)
  function ambient() {
    if (reduce) return;
    var host = document.querySelector(".hero, header.hero, .hero-section, main section, header");
    if (!host) return;
    var cs = window.getComputedStyle(host);
    if (cs.position === "static") host.classList.add("sx-host");
    var box = document.createElement("div");
    box.className = "sx-embers";
    for (var i = 0; i < 18; i++) {
      var e = document.createElement("div");
      e.className = "sx-ember";
      e.style.left = (Math.random() * 100) + "%";
      e.style.animationDuration = (6 + Math.random() * 7) + "s";
      e.style.animationDelay = (Math.random() * 8) + "s";
      e.style.transform = "scale(" + (0.5 + Math.random() * 1.3) + ")";
      e.style.setProperty("--sx-sway", (Math.random() * 120 - 60) + "px");
      box.appendChild(e);
    }
    host.insertBefore(box, host.firstChild);
  }

  // 2. Optional steam wisps on any [data-sx-steam] element
  function steam() {
    if (reduce) return;
    document.querySelectorAll("[data-sx-steam]").forEach(function (el) {
      var cs = window.getComputedStyle(el);
      if (cs.position === "static") el.classList.add("sx-host");
      for (var i = 0; i < 5; i++) {
        var s = document.createElement("span");
        s.className = "sx-steam";
        s.style.left = (38 + i * 6) + "%";
        s.style.setProperty("--sx-dx", (Math.random() * 100 - 50) + "px");
        s.style.animation = "sx-rise " + (3.8 + Math.random() * 1.6) + "s ease-in " + (i * 0.7) + "s infinite";
        el.appendChild(s);
      }
    });
  }

  // 3. Scroll reveal on content sections
  function reveal() {
    var secs = document.querySelectorAll("main section, .section, [data-sx-reveal]");
    if (!secs.length || !("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (x) {
        if (x.isIntersecting) { x.target.classList.add("sx-in"); io.unobserve(x.target); }
      });
    }, { threshold: 0.12 });
    secs.forEach(function (s) { s.classList.add("sx-reveal"); io.observe(s); });
  }

  // 4. Optional crossfade slideshow — needs <div id="sxShow" data-slides='[{"src","cap"}]'>
  function slideshow() {
    var el = document.getElementById("sxShow");
    if (!el) return;
    var slides;
    try { slides = JSON.parse(el.getAttribute("data-slides") || "[]"); } catch (e) { slides = []; }
    if (!slides.length) return;
    el.classList.add("sx-show");
    var dots = document.createElement("div"); dots.className = "sx-dots";
    el.insertAdjacentElement("afterend", dots);
    var cur = 0, t;
    slides.forEach(function (s, i) {
      var d = document.createElement("div"); d.className = "sx-slide" + (i === 0 ? " sx-on" : "");
      d.innerHTML = '<img src="' + s.src + '" alt="' + (s.cap || "") + '" loading="lazy">' +
        (s.cap ? '<div class="sx-cap">' + s.cap + "</div>" : "");
      el.appendChild(d);
      var b = document.createElement("button"); if (i === 0) b.className = "sx-on";
      b.addEventListener("click", function () { go(i); }); dots.appendChild(b);
    });
    var S = el.querySelectorAll(".sx-slide"), B = dots.querySelectorAll("button");
    function go(n) {
      S[cur].classList.remove("sx-on"); B[cur].classList.remove("sx-on");
      cur = (n + S.length) % S.length;
      S[cur].classList.add("sx-on"); B[cur].classList.add("sx-on"); restart();
    }
    function restart() { clearInterval(t); if (!reduce) t = setInterval(function () { go(cur + 1); }, 4500); }
    var p = document.createElement("button"); p.className = "sx-arw sx-prev"; p.innerHTML = "&#8249;";
    var nx = document.createElement("button"); nx.className = "sx-arw sx-next"; nx.innerHTML = "&#8250;";
    p.addEventListener("click", function () { go(cur - 1); });
    nx.addEventListener("click", function () { go(cur + 1); });
    el.appendChild(p); el.appendChild(nx);
    el.addEventListener("mouseenter", function () { clearInterval(t); });
    el.addEventListener("mouseleave", restart);
    restart();
  }

  function init() { try { ambient(); steam(); reveal(); slideshow(); } catch (e) { /* never break the page */ } }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
