# Ads and analytics tracking — the standard (Google's own setup)

Our sites track ads the way Google's own people set it up on Claflin Construction's site (claflinconstruction.net),
because that setup works and the one we built before it did not (owner, 2026-10-20: "save it for our shit since it works
and google did it. because when you did it it didnt work"). Read from that live site and its Tag Manager container
(GTM-T7VQVK7P), 2026-10-20, read-only. Never change Claflin's own container or site — this file only copies the pattern.

## The rules

1. **Google Tag Manager only.** One container snippet. No gtag.js, GA4 or Ads tag written into the page beside it — every
   Google tag lives inside the container. (A site that sets a GTM container never also prints a GA4 id.)
2. **The head snippet** goes at the top of `<head>`, right after `<meta charset>` / viewport / title:

   ```html
   <!-- Google Tag Manager -->
   <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
   new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
   j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
   'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
   })(window,document,'script','dataLayer','GTM-XXXXXXX');</script>
   ```
3. **The noscript iframe** goes first thing inside `<body>`:

   ```html
   <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX"
   height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
   ```
4. **What the container does** (Google's tags, set up inside GTM, not in our code):
   - the Google Ads base tag (`AW-<id>`), on every page;
   - a **form conversion**, fired by an **Element Visibility** trigger on the CSS selector `#form-success`;
   - a **phone conversion**, fired by a **click** trigger on any click whose URL contains `tel:`.
5. **So the page must give the container what its triggers watch:**
   - every lead form, on success, **shows an element with `id="form-success"`** that was in the page, hidden
     (`display:none`), from load — set to `display:block` when the server accepts the lead (not before), then scrolled
     into view. One per page: a page with more than one form shows the one shared `#form-success`.
   - every phone number is a real `<a href="tel:…">` link.
6. **Nothing blocks the container.** The page's Content-Security-Policy allows everything GTM and Google Ads load and
   send to (googletagmanager.com, google.com, googleadservices.com, googleads.g.doubleclick.net, google-analytics.com,
   pagead2.googlesyndication.com) — checked in GTM Preview on a staging copy before a site goes live.
7. **Ad click ids survive.** Every redirect keeps the query string, so `gclid` reaches the landing page.

## Where the unified app stands (2026-10-20 copy test, scratchpad claflin/compare.tsv)

Prints the GTM head snippet and noscript. To meet this standard it still needs: the shared `#form-success` element on
every lead form (rule 5), a CSP that allows the Google hosts (rule 6, unverified whether it blocks them today), and no GA4
printed when a GTM container is set (rule 1).
