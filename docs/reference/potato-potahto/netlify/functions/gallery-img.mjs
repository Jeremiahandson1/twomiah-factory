import { getStore } from "@netlify/blobs";

// Serves admin-uploaded gallery images from the pp-images blob store.
// Native function route (Netlify Functions 2.0): /img/gallery/<key>.webp|.jpg
// Keys are content hashes, so responses are safely immutable / long-cached.
export default async (req) => {
  const u = new URL(req.url);
  // Key is the last path segment (/img/gallery/<key>); ?k= kept as a fallback.
  const k = decodeURIComponent(u.pathname.split("/").pop() || "") || u.searchParams.get("k") || "";
  if (!/^[a-f0-9]{16,64}\.(webp|jpg)$/.test(k)) return new Response("Not found", { status: 404 });

  // Strong consistency so a freshly-uploaded image is readable immediately.
  const store = getStore({ name: "pp-images", consistency: "strong" });
  const buf = await store.get(k, { type: "arrayBuffer" });
  if (!buf) return new Response("Not found", { status: 404 });

  return new Response(buf, {
    headers: {
      "content-type": k.endsWith(".jpg") ? "image/jpeg" : "image/webp",
      "cache-control": "public, max-age=31536000, immutable"
    }
  });
};

export const config = { path: "/img/gallery/:name" };
