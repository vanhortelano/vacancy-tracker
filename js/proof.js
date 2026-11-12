/* Shared by the admin app (index.html) and the viewer page (viewer.html).
   The dorm password is never stored. Both sides turn "code + password" into a
   one-way fingerprint (SHA-256); the server only compares fingerprints. */

function normalizeDormCode(value){
  return String(value || "").trim().toLowerCase();
}

function isValidDormCode(code){
  return /^[a-z0-9][a-z0-9-]{3,29}$/.test(code);
}

async function sha256Hex(text){
  if (!window.crypto || !window.crypto.subtle){
    throw new Error("Open this page through https:// (or localhost) so the password can be checked safely.");
  }
  const bytes = new TextEncoder().encode(text);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

function viewerProof(code, password){
  return sha256Hex("dorm-viewer:" + code + ":" + password);
}
