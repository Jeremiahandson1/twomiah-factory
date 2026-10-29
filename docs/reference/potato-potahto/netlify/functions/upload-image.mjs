import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

// Receives a web-sized image (base64) from the admin panel, stores the bytes
// in the pp-images blob store under a content-hash key, and returns the public URL
// that gallery-img serves. Auth mirrors site.mjs (x-admin-key === ADMIN_KEY).
//
// The admin resizes in-browser before sending, so payloads stay small (well under
// the function body limit). WebP preferred; JPEG accepted for browsers that can't
// encode WebP from a canvas (Safari).
export default async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const key = req.headers.get("x-admin-key") || "";
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body;
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }

  const raw = String((body && body.data) || "");
  // Accept a WebP or JPEG data: URL, or a bare base64 string (treated as WebP).
  const m = raw.match(/^data:image\/(webp|jpeg);base64,([A-Za-z0-9+/=]+)$/);
  const bare = m ? null : raw.match(/^([A-Za-z0-9+/=]+)$/);
  if (!m && !bare) return new Response("Only WebP or JPEG images accepted", { status: 400 });
  const fmt = m ? m[1] : "webp";

  const bytes = Buffer.from(m ? m[2] : bare[1], "base64");
  if (!bytes.length) return new Response("Empty image", { status: 400 });
  if (bytes.length > 1_500_000) return new Response("Image too large", { status: 413 });

  const ext = fmt === "jpeg" ? "jpg" : "webp";
  const name = createHash("sha256").update(bytes).digest("hex").slice(0, 24) + "." + ext;
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

  const store = getStore({ name: "pp-images", consistency: "strong" });
  await store.set(name, ab, { metadata: { contentType: "image/" + fmt } });

  return Response.json({ url: "/img/gallery/" + name });
};
