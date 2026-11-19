import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  sendPasswordResetEmail,
  deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { auth, db, firebaseConfig } from "./firebase-config.js";

/*Setup*/

const configReady = true;

const page = document.body.dataset.page;
/*Theme (Light / Dark Mode)*/
function getPreferredTheme() {
  const saved = localStorage.getItem("theme");
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  document.querySelectorAll('[data-action="toggle-theme"]').forEach((btn) => {
    const isDark = theme === "dark";
    btn.innerHTML = `<i class="fa-solid ${isDark ? "fa-sun" : "fa-moon"}"></i>`;
    btn.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
    btn.title = isDark ? "Switch to light mode" : "Switch to dark mode";
  });
}

applyTheme(getPreferredTheme());

let registering = false;
let pageStarted = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9\s().-]{5,19}$/;
const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"];

const DEFAULT_PRIVACY = {
  fullName: true,
  photo: false,
  bloodType: true,
  allergies: true,
  conditions: true,
  medications: false,
  notes: false,
  contactName: true,
  contactPhone: true
};

const PRIVACY_FIELDS = [
  ["fullName", "Full name"],
  ["photo", "Profile photo"],
  ["bloodType", "Blood type"],
  ["allergies", "Allergies"],
  ["conditions", "Medical conditions"],
  ["medications", "Current medications"],
  ["notes", "Medical notes"],
  ["contactName", "Primary contact name and relationship"],
  ["contactPhone", "Primary contact phone number"]
];

/*Small helpers*/

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function clean(value) {
  return String(value ?? "").trim();
}

function firstName(fullName) {
  return clean(fullName).split(/\s+/)[0] || "there";
}

function telHref(phone) {
  return "tel:" + String(phone).replace(/[^\d+]/g, "");
}

function safeImage(src) {
  return typeof src === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src) ? src : "";
}

function toast(message, type = "success") {
  let stack = $(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    stack.setAttribute("role", "status");
    document.body.appendChild(stack);
  }
  const item = document.createElement("div");
  item.className = "toast " + type;
  item.textContent = message;
  stack.appendChild(item);
  setTimeout(() => item.remove(), 3500);
}

function setBusy(button, busy) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="spinner small"></span> Please wait';
  } else {
    button.disabled = false;
    if (button.dataset.label) button.innerHTML = button.dataset.label;
  }
}

function fieldError(id, message) {
  const input = document.getElementById(id);
  if (!input) return;
  const field = input.closest(".field");
  field.classList.toggle("invalid", Boolean(message));
  const slot = $(".error", field);
  if (slot) slot.textContent = message || "";
}

function clearErrors(form) {
  $$(".field.invalid", form).forEach((field) => field.classList.remove("invalid"));
  $$(".field .error", form).forEach((slot) => { slot.textContent = ""; });
  const box = $(".form-error", form);
  if (box) { box.textContent = ""; box.classList.remove("show"); }
}

function formError(form, message) {
  const box = $(".form-error", form);
  if (!box) return toast(message, "error");
  box.textContent = message;
  box.classList.add("show");
}

function confirmDialog({ title, message, okLabel = "Confirm" }) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "modal";
    dialog.innerHTML = `
      <form method="dialog" class="modal-body">
        <h3>${esc(title)}</h3>
        <p>${esc(message)}</p>
        <div class="modal-actions">
          <button value="cancel" class="btn btn-ghost">Cancel</button>
          <button value="ok" class="btn btn-primary">${esc(okLabel)}</button>
        </div>
      </form>`;
    document.body.appendChild(dialog);
    dialog.addEventListener("close", () => {
      const accepted = dialog.returnValue === "ok";
      dialog.remove();
      resolve(accepted);
    });
    dialog.showModal();
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    window.prompt("Copy this link:", text);
  }
}

async function shareLink(url, title) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text: "Emergency information shared by its owner.", url });
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }
  await copyText(url);
  toast("Link copied");
}

function authMessage(err) {
  switch (err.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Email or password is incorrect.";
    case "auth/email-already-in-use":
      return "An account with this email already exists.";
    case "auth/weak-password":
      return "Choose a stronger password.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a few minutes and try again.";
    case "auth/network-request-failed":
      return "Network error. Check your internet connection.";
    case "auth/operation-not-allowed":
      return "Email and password sign-in is not enabled in your Firebase project.";
    case "auth/requires-recent-login":
      return "Log out and log in again, then retry.";
    default:
      return "Something went wrong (" + (err.code || err.message) + ").";
  }
}

function showConfigBanner() {
  const bar = document.createElement("div");
  bar.className = "banner";
  bar.innerHTML = "<strong>Firebase is not connected.</strong> Open <code>firebase-config.js</code> and paste your project settings. See README.txt.";
  document.body.prepend(bar);
}

function showPageError(err) {
  console.error(err);
  $("#loading")?.remove();
  const box = $("#page-error");
  if (!box) return;
  let message = "Could not load your data. Check your internet connection and try again.";
  if (err && err.code === "permission-denied") {
    message = "Firestore blocked the request. Publish the rules from firestore.rules in your Firebase console.";
  }
  box.textContent = message;
  box.classList.add("show");
}

function finishLoading() {
  $("#loading")?.remove();
  $("#page-body")?.classList.remove("hidden");
}

function resizeImageToSquare(file, size = 256) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const side = Math.min(image.width, image.height);
      const sx = (image.width - side) / 2;
      const sy = (image.height - side) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      canvas.getContext("2d").drawImage(image, sx, sy, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Not a readable image")); };
    image.src = url;
  });
}



function loadLocalQrScript() {
  if (typeof window.QRCode === "function" && window.QRCode.CorrectLevel) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-qr-lib]');
    if (existing) {
      existing.addEventListener("load", resolve);
      existing.addEventListener("error", reject);
      return;
    }
    const s = document.createElement("script");
    s.src = new URL("./qrcode.min.js", import.meta.url).href;
    s.dataset.qrLib = "true";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load local js/qrcode.min.js"));
    document.head.appendChild(s);
  });
}

async function drawQr(canvas, text, size = 240) {
  try {
    await loadLocalQrScript();

    const holder = document.createElement("div");
    holder.id = canvas.id;
    holder.style.display = "inline-block";
    holder.style.background = "#FFFFFF";
    holder.style.padding = "10px";
    holder.style.borderRadius = "12px";
    holder.style.border = "1px solid var(--border)";
    holder.setAttribute("aria-label", "QR code for your emergency card");
    canvas.replaceWith(holder);

    new window.QRCode(holder, {
      text: text,
      width: size,
      height: size,
      colorDark: "#252525",
      colorLight: "#FFFFFF",
      correctLevel: window.QRCode.CorrectLevel.M
    });

    return true;
  } catch (error) {
    console.error("QR generation failed:", error);
    const message = document.createElement("p");
    message.className = "notice warn";
    message.textContent = "Could not generate the QR code. Check that js/qrcode.min.js exists.";
    canvas.replaceWith(message);
    return false;
  }
}


/*Data access*/

async function getUserDoc(uid) {
  const snap = await getDoc(doc(db, "Users", uid));
  if (snap.exists()) return snap.data();
  return { uid, fullName: auth.currentUser?.displayName || "", email: auth.currentUser?.email || "" };
}

async function getMedical(uid) {
  const snap = await getDoc(doc(db, "MedicalInformation", uid));
  return snap.exists() ? snap.data() : {};
}

async function getContacts(uid) {
  const q = query(collection(db, "EmergencyContacts"), where("userId", "==", uid));
  const snap = await getDocs(q);
  const list = snap.docs.map((d) => ({ contactId: d.id, ...d.data() }));
  const rank = (c) => (c.priority === "Primary" ? 0 : 1);
  return list.sort((a, b) => rank(a) - rank(b) || clean(a.contactName).localeCompare(clean(b.contactName)));
}

async function loadAll(uid) {
  return Promise.all([getUserDoc(uid), getMedical(uid), getContacts(uid)]);
}

function primaryContact(contacts) {
  return contacts.find((c) => c.priority === "Primary") || contacts[0] || null;
}

function ownCardData(user, medical, contacts) {
  const primary = primaryContact(contacts);
  return {
    fullName: clean(user.fullName),
    profileImage: user.profileImage || "",
    bloodType: clean(medical.bloodType),
    allergies: clean(medical.allergies),
    medicalConditions: clean(medical.medicalConditions),
    medications: clean(medical.medications),
    contactName: primary ? clean(primary.contactName) : "",
    contactRelationship: primary ? clean(primary.relationship) : "",
    contactPhone: primary ? clean(primary.phoneNumber) : ""
  };
}

function buildSharedData(user, medical, contacts, privacy) {
  const p = { ...DEFAULT_PRIVACY, ...(privacy || {}) };
  const primary = primaryContact(contacts);
  const data = {};
  const put = (key, value) => { if (clean(value)) data[key] = clean(value); };

  if (p.fullName) put("fullName", user.fullName);
  if (p.photo && user.profileImage) data.profileImage = user.profileImage;
  if (p.bloodType) put("bloodType", medical.bloodType);
  if (p.allergies) put("allergies", medical.allergies);
  if (p.conditions) put("medicalConditions", medical.medicalConditions);
  if (p.medications) put("medications", medical.medications);
  if (p.notes) put("medicalNotes", medical.medicalNotes);
  if (primary) {
    if (p.contactName) {
      put("contactName", primary.contactName);
      put("contactRelationship", primary.relationship);
    }
    if (p.contactPhone) put("contactPhone", primary.phoneNumber);
  }
  return data;
}

async function writeSharedCard(uid, token, privacy) {
  const [user, medical, contacts] = await loadAll(uid);
  await setDoc(doc(db, "SharedCards", token), {
    ownerId: uid,
    data: buildSharedData(user, medical, contacts, privacy),
    updatedAt: serverTimestamp()
  });
}

async function syncSharedCard(uid) {
  try {
    const user = await getUserDoc(uid);
    if (user.shareToken) await writeSharedCard(uid, user.shareToken, user.privacy);
  } catch (err) {
    console.error("Could not update shared card", err);
    toast("Saved, but the shared QR card could not be updated.", "error");
  }
}

function makeToken() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function shareUrl(token) {
  return new URL("share.html?t=" + token, location.href).href;
}

/*Shared page pieces*/

const NAV_KEY = {
  dashboard: "home",
  "emergency-card": "card",
  qr: "card",
  contacts: "contacts",
  "medical-info": "medical",
  settings: "settings",
  "personal-info": "settings"
};

function renderShell() {
  const active = NAV_KEY[page];
  const side = [
    ["home", "dashboard.html", "fa-house", "Dashboard"],
    ["card", "emergency-card.html", "fa-id-card", "Emergency Card"],
    ["contacts", "contacts.html", "fa-address-book", "Emergency Contacts"],
    ["medical", "medical-info.html", "fa-notes-medical", "Medical Information"],
    ["settings", "settings.html", "fa-gear", "Settings"]
  ];
  const bottom = [
    ["home", "dashboard.html", "fa-house", "Home"],
    ["card", "emergency-card.html", "fa-id-card", "Card"],
    ["contacts", "contacts.html", "fa-address-book", "Contacts"],
    ["medical", "medical-info.html", "fa-notes-medical", "Medical Info"]
  ];
  const link = ([key, href, icon, label]) =>
    `<a href="${href}" class="${key === active ? "active" : ""}" ${key === active ? 'aria-current="page"' : ""}><i class="fa-solid ${icon}"></i><span>${label}</span></a>`;

  const sidebar = $("#sidebar-root");
  if (sidebar) {
    sidebar.innerHTML = `
      <a class="brand" href="dashboard.html"><span class="med-cross"><i class="fa-solid fa-plus"></i></span><span>Emergency Info Card</span></a>
      <nav class="side-links" aria-label="Main">${side.map(link).join("")}</nav>
      <button type="button" class="side-logout" data-action="logout"><i class="fa-solid fa-right-from-bracket"></i> Log out</button>`;
  }
  const bottomNav = $("#bottom-root");
  if (bottomNav) {
    bottomNav.setAttribute("aria-label", "Main");
    bottomNav.innerHTML = bottom.map(link).join("");
  }
      const top = $("#topbar-root");
  if (top) {
    const emergency = page === "dashboard" ? "" :
      '<a class="btn btn-primary btn-sm" href="emergency-mode.html"><i class="fa-solid fa-triangle-exclamation"></i><span>Emergency Mode</span></a>';
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    top.innerHTML = `
      <h1>${esc(document.body.dataset.title || "")}</h1>
      <div class="top-actions">
        ${emergency}
        <button type="button" class="icon-btn" data-action="toggle-theme" aria-label="${isDark ? "Switch to light mode" : "Switch to dark mode"}" title="${isDark ? "Switch to light mode" : "Switch to dark mode"}">
          <i class="fa-solid ${isDark ? "fa-sun" : "fa-moon"}"></i>
        </button>
        <a class="icon-btn" href="settings.html" aria-label="Settings"><i class="fa-solid fa-gear"></i></a>
        <a class="avatar-btn" id="top-avatar" href="personal-info.html" aria-label="Profile"><i class="fa-solid fa-user"></i></a>
      </div>`;
  }
}

function setTopAvatar(image) {
  const src = safeImage(image);
  const slot = $("#top-avatar");
  if (slot && src) slot.innerHTML = `<img src="${src}" alt="Your profile photo">`;
}

function infoRow(icon, label, value, hideMissing) {
  if (value === undefined) return "";
  const has = clean(value) !== "";
  if (!has && hideMissing) return "";
  return `<div class="info-row">
    <div class="info-label"><i class="fa-solid ${icon}"></i>${label}</div>
    <div class="info-value">${has ? esc(value) : '<span class="np">Not provided</span>'}</div>
  </div>`;
}

function cardHTML(d, { compact = false, hideMissing = false } = {}) {
  const photo = safeImage(d.profileImage);
  const avatar = photo
    ? `<img class="avatar-lg" src="${photo}" alt="Profile photo">`
    : '<span class="avatar-lg"><i class="fa-solid fa-user"></i></span>';
  const name = clean(d.fullName) || (hideMissing ? "Name not shared" : "Name not provided");
  const showBlood = d.bloodType !== undefined && (clean(d.bloodType) || !hideMissing);
  const blood = showBlood ? `<span class="pill red">Blood type: ${esc(clean(d.bloodType) || "Not provided")}</span>` : "";

  let contact = "";
  if (d.contactName !== undefined || d.contactPhone !== undefined) {
    const who = clean(d.contactName)
      ? esc(d.contactName) + (clean(d.contactRelationship) ? " (" + esc(d.contactRelationship) + ")" : "")
      : "";
    const phone = clean(d.contactPhone)
      ? `<a href="${telHref(d.contactPhone)}">${esc(d.contactPhone)}</a>`
      : "";
    if (who || phone || !hideMissing) {
      contact = `<div class="info-row">
        <div class="info-label"><i class="fa-solid fa-phone"></i>Primary emergency contact</div>
        <div class="info-value">${who || '<span class="np">Not provided</span>'}${phone ? "<br>" + phone : (d.contactPhone !== undefined && !hideMissing ? '<br><span class="np">No phone number</span>' : "")}</div>
      </div>`;
    }
  }

  return `<div class="id-card">
    <div class="id-card-head">
      <span class="med-cross"><i class="fa-solid fa-plus"></i></span>
      <div><strong>Emergency Info Card</strong><small>Medical and contact details</small></div>
    </div>
    <div class="id-card-body">
      <div class="id-person">${avatar}<div><h3>${esc(name)}</h3>${blood}</div></div>
      ${infoRow("fa-triangle-exclamation", "Allergies", d.allergies, hideMissing)}
      ${infoRow("fa-heart-pulse", "Medical conditions", d.medicalConditions, hideMissing)}
      ${compact ? "" : infoRow("fa-pills", "Current medications", d.medications, hideMissing)}
      ${compact ? "" : infoRow("fa-note-sticky", "Medical notes", d.medicalNotes, hideMissing)}
      ${contact}
    </div>
  </div>`;
}

/*Welcome, login, register*/

function initLogin() {
  const form = $("#login-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors(form);
    const email = clean($("#email").value);
    const password = $("#password").value;
    let valid = true;
    if (!EMAIL_RE.test(email)) { fieldError("email", "Enter a valid email address."); valid = false; }
    if (!password) { fieldError("password", "Enter your password."); valid = false; }
    if (!valid) return;
    if (!configReady) return formError(form, "Firebase is not set up yet. Edit firebase-config.js first.");

    const button = $("#submit-btn");
    setBusy(button, true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      location.replace("dashboard.html");
    } catch (err) {
      formError(form, authMessage(err));
      setBusy(button, false);
    }
  });

  $("#forgot-link").addEventListener("click", async (event) => {
    event.preventDefault();
    clearErrors(form);
    const email = clean($("#email").value);
    if (!EMAIL_RE.test(email)) return fieldError("email", "Enter your email first, then select Forgot password.");
    if (!configReady) return formError(form, "Firebase is not set up yet. Edit firebase-config.js first.");
    try {
      await sendPasswordResetEmail(auth, email);
      toast("If an account exists for this email, a reset link was sent.");
    } catch (err) {
      formError(form, authMessage(err));
    }
  });
}

function initRegister() {
  const form = $("#register-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors(form);
    const fullName = clean($("#fullName").value);
    const email = clean($("#email").value);
    const password = $("#password").value;
    const confirm = $("#confirmPassword").value;
    let valid = true;
    if (fullName.length < 2) { fieldError("fullName", "Enter your full name."); valid = false; }
    if (!EMAIL_RE.test(email)) { fieldError("email", "Enter a valid email address."); valid = false; }
    if (password.length < 8) { fieldError("password", "Use at least 8 characters."); valid = false; }
    if (confirm !== password) { fieldError("confirmPassword", "Passwords do not match."); valid = false; }
    if (!valid) return;
    if (!configReady) return formError(form, "Firebase is not set up yet. Edit firebase-config.js first.");

    const button = $("#submit-btn");
    setBusy(button, true);
    registering = true;
    let credential;
    try {
      credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName: fullName });
    } catch (err) {
      registering = false;
      formError(form, authMessage(err));
      setBusy(button, false);
      return;
    }

    const uid = credential.user.uid;
    try {
      await setDoc(doc(db, "Users", uid), {
        uid, fullName, email, dateOfBirth: "", gender: "", address: "", phoneNumber: "",
        profileImage: "", privacy: DEFAULT_PRIVACY, createdAt: serverTimestamp()
      });
      await setDoc(doc(db, "MedicalInformation", uid), {
        userId: uid, bloodType: "", allergies: "", medicalConditions: "", medications: "",
        medicalNotes: "", otherInfo: ""
      });
    } catch (err) {
      console.error(err);
      toast("Account created, but your profile could not be saved. Check your Firestore rules.", "error");
    }
    location.replace("dashboard.html");
  });
}

/*Dashboard*/

async function initDashboard(uid) {
  const [user, medical, contacts] = await loadAll(uid);
  setTopAvatar(user.profileImage);
  $("#greeting").textContent = "Hello, " + firstName(user.fullName || auth.currentUser.displayName);

  $("#card-preview").innerHTML = cardHTML(ownCardData(user, medical, contacts), { compact: true });

  const preview = $("#contacts-preview");
  if (!contacts.length) {
    preview.innerHTML = `<div class="empty"><i class="fa-solid fa-address-book"></i>No emergency contacts yet.<br><br><a class="btn btn-primary btn-sm" href="contacts.html">Add a contact</a></div>`;
  } else {
    preview.innerHTML = contacts.slice(0, 3).map((c) => `
      <div class="mini-contact">
        <span class="contact-icon"><i class="fa-solid fa-user"></i></span>
        <div class="contact-info"><strong>${esc(c.contactName)}</strong><span class="muted">${esc(c.relationship)} · ${esc(c.priority)}</span></div>
        <a class="btn btn-outline btn-sm" href="${telHref(c.phoneNumber)}" aria-label="Call ${esc(c.contactName)}"><i class="fa-solid fa-phone"></i><span>Call</span></a>
      </div>`).join("");
  }
  finishLoading();
}

/*Emergency card page*/

async function initEmergencyCard(uid) {
  const [user, medical, contacts] = await loadAll(uid);
  setTopAvatar(user.profileImage);
  $("#card-area").innerHTML = cardHTML(ownCardData(user, medical, contacts));

  const url = user.shareToken ? shareUrl(user.shareToken) : "";
  const qrBox = $("#qr-box");
  if (url) {
    qrBox.innerHTML = `<canvas id="qr-canvas"></canvas>
      <p class="muted" style="margin-top:10px">Scanning opens only the details you chose to share.</p>`;
    await drawQr($("#qr-canvas"), url, 200);
  } else {
    qrBox.innerHTML = `<div class="empty"><i class="fa-solid fa-qrcode"></i>QR sharing is off.<br>Nothing is public right now.<br><br><a class="btn btn-outline btn-sm" href="qr.html">Set up QR sharing</a></div>`;
  }

  $("#share-card-btn").addEventListener("click", async () => {
    if (!url) {
      toast("Turn on QR sharing first.", "info");
      setTimeout(() => location.assign("qr.html"), 900);
      return;
    }
    await shareLink(url, "Emergency Info Card");
  });
  $("#print-btn").addEventListener("click", () => window.print());
  finishLoading();
}

/*Emergency mode*/

async function initEmergencyMode(uid) {
  const [user, medical, contacts] = await loadAll(uid);
  const data = ownCardData(user, medical, contacts);
  const none = '<span class="np" style="font-weight:400">Not provided</span>';
  const show = (id, value) => { $(id).innerHTML = clean(value) ? esc(value) : none; };

  show("#em-name", data.fullName || "Name not provided");
  show("#em-blood", data.bloodType);
  show("#em-allergies", data.allergies);
  show("#em-conditions", data.medicalConditions);
  show("#em-contact-name", data.contactName ? data.contactName + (data.contactRelationship ? " (" + data.contactRelationship + ")" : "") : "");
  show("#em-contact-phone", data.contactPhone);

  const call = $("#em-call");
  if (data.contactPhone) {
    call.href = telHref(data.contactPhone);
  } else {
    call.classList.add("disabled");
    call.removeAttribute("href");
    call.setAttribute("aria-disabled", "true");
    $("#em-no-contact").classList.remove("hidden");
  }
  finishLoading();
}

/*Contacts*/

async function initContacts(uid) {
  let contacts = await getContacts(uid);
  const list = $("#contact-list");
  const modal = $("#contact-modal");
  const form = $("#contact-form");

  function render() {
    if (!contacts.length) {
      list.innerHTML = `<div class="card empty"><i class="fa-solid fa-address-book"></i>No emergency contacts yet.<br>Add someone who should be called in an emergency.</div>`;
      return;
    }
    list.innerHTML = contacts.map((c) => `
      <article class="card contact-card">
        <span class="contact-icon"><i class="fa-solid fa-user"></i></span>
        <div class="contact-info">
          <h3>${esc(c.contactName)} <span class="pill ${c.priority === "Primary" ? "red" : ""}">${esc(c.priority)}</span></h3>
          <div class="muted">${esc(c.relationship)}</div>
          <div class="contact-phone">${esc(c.phoneNumber)}</div>
          <div class="btn-row">
            <a class="btn btn-primary btn-sm" href="${telHref(c.phoneNumber)}"><i class="fa-solid fa-phone"></i> Call</a>
            <button type="button" class="btn btn-ghost btn-sm" data-action="edit" data-id="${esc(c.contactId)}"><i class="fa-solid fa-pen"></i> Edit</button>
            <button type="button" class="btn btn-outline btn-sm" data-action="delete" data-id="${esc(c.contactId)}"><i class="fa-solid fa-trash"></i> Delete</button>
          </div>
        </div>
      </article>`).join("");
  }

  function openForm(contact) {
    clearErrors(form);
    form.reset();
    $("#contactId").value = contact ? contact.contactId : "";
    $("#contact-modal-title").textContent = contact ? "Edit contact" : "Add contact";
    $("#contactName").value = contact ? contact.contactName : "";
    $("#relationship").value = contact ? contact.relationship : "";
    $("#phoneNumber").value = contact ? contact.phoneNumber : "";
    $("#priority").value = contact ? contact.priority : (contacts.length === 0 ? "Primary" : "Secondary");
    modal.showModal();
  }

  $("#add-contact-btn").addEventListener("click", () => openForm(null));
  $("#cancel-contact").addEventListener("click", () => modal.close());

  list.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const contact = contacts.find((c) => c.contactId === button.dataset.id);
    if (!contact) return;

    if (button.dataset.action === "edit") return openForm(contact);

    const ok = await confirmDialog({
      title: "Delete this contact?",
      message: contact.contactName + " will be removed from your emergency contacts. This cannot be undone.",
      okLabel: "Delete"
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "EmergencyContacts", contact.contactId));
      contacts = contacts.filter((c) => c.contactId !== contact.contactId);
      render();
      toast("Contact deleted.");
      await syncSharedCard(uid);
    } catch (err) {
      console.error(err);
      toast("Could not delete the contact.", "error");
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors(form);
    const contactName = clean($("#contactName").value);
    const relationship = clean($("#relationship").value);
    const phoneNumber = clean($("#phoneNumber").value);
    const priority = $("#priority").value;
    let valid = true;
    if (contactName.length < 2 || contactName.length > 60) { fieldError("contactName", "Enter a name of 2 to 60 characters."); valid = false; }
    if (relationship.length < 2 || relationship.length > 40) { fieldError("relationship", "Enter the relationship, for example Mother."); valid = false; }
    if (!PHONE_RE.test(phoneNumber)) { fieldError("phoneNumber", "Enter a valid phone number, for example +63 912 345 6789."); valid = false; }
    if (!["Primary", "Secondary"].includes(priority)) { fieldError("priority", "Choose Primary or Secondary."); valid = false; }
    if (!valid) return;

    const button = $("#save-contact-btn");
    setBusy(button, true);
    try {
      const existingId = $("#contactId").value;
      const ref = existingId ? doc(db, "EmergencyContacts", existingId) : doc(collection(db, "EmergencyContacts"));
      const batch = writeBatch(db);
      batch.set(ref, { contactId: ref.id, userId: uid, contactName, relationship, phoneNumber, priority });
      if (priority === "Primary") {
        contacts
          .filter((c) => c.contactId !== ref.id && c.priority === "Primary")
          .forEach((c) => batch.update(doc(db, "EmergencyContacts", c.contactId), { priority: "Secondary" }));
      }
      await batch.commit();
      contacts = await getContacts(uid);
      render();
      modal.close();
      toast(existingId ? "Contact updated." : "Contact added.");
      await syncSharedCard(uid);
    } catch (err) {
      console.error(err);
      formError(form, "Could not save the contact. Try again.");
    }
    setBusy(button, false);
  });

  render();
  finishLoading();
}

/*Medical information*/

async function initMedical(uid) {
  const [user, medical] = await Promise.all([getUserDoc(uid), getMedical(uid)]);
  setTopAvatar(user.profileImage);
  const form = $("#medical-form");
  const textFields = ["allergies", "medicalConditions", "medications", "medicalNotes", "otherInfo"];

  $("#bloodType").value = BLOOD_TYPES.includes(medical.bloodType) ? medical.bloodType : "";
  textFields.forEach((id) => { $("#" + id).value = medical[id] || ""; });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors(form);
    let valid = true;
    textFields.forEach((id) => {
      if ($("#" + id).value.length > 1000) { fieldError(id, "Keep this under 1000 characters."); valid = false; }
    });
    if (!valid) return;

    const data = { userId: uid, bloodType: $("#bloodType").value };
    textFields.forEach((id) => { data[id] = clean($("#" + id).value); });

    const button = $("#save-btn");
    setBusy(button, true);
    try {
      await setDoc(doc(db, "MedicalInformation", uid), data, { merge: true });
      toast("Medical information saved.");
      await syncSharedCard(uid);
    } catch (err) {
      console.error(err);
      formError(form, "Could not save. Check your connection and Firestore rules.");
    }
    setBusy(button, false);
  });
  finishLoading();
}

/*Personal information*/

async function initPersonal(uid) {
  const user = await getUserDoc(uid);
  const form = $("#personal-form");
  let photo = user.profileImage || "";
  setTopAvatar(photo);

  $("#dateOfBirth").max = new Date().toISOString().split("T")[0];
  $("#fullName").value = user.fullName || "";
  $("#dateOfBirth").value = user.dateOfBirth || "";
  $("#gender").value = user.gender || "";
  $("#address").value = user.address || "";
  $("#phoneNumber").value = user.phoneNumber || "";
  $("#email").value = user.email || auth.currentUser.email || "";

  function drawPhoto() {
    const src = safeImage(photo);
    $("#photo-preview").innerHTML = src
      ? `<img class="avatar-lg" src="${src}" alt="Profile photo preview">`
      : '<span class="avatar-lg"><i class="fa-solid fa-user"></i></span>';
    $("#remove-photo-btn").classList.toggle("hidden", !src);
  }
  drawPhoto();

  $("#photo-input").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("Choose an image file.", "error");
    if (file.size > 8 * 1024 * 1024) return toast("Choose an image under 8 MB.", "error");
    try {
      photo = await resizeImageToSquare(file);
      drawPhoto();
    } catch (err) {
      toast("That image could not be read.", "error");
    }
    event.target.value = "";
  });

  $("#remove-photo-btn").addEventListener("click", () => { photo = ""; drawPhoto(); });
  $("#cancel-btn").addEventListener("click", () => location.assign("dashboard.html"));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors(form);
    const fullName = clean($("#fullName").value);
    const dateOfBirth = $("#dateOfBirth").value;
    const gender = $("#gender").value;
    const address = clean($("#address").value);
    const phoneNumber = clean($("#phoneNumber").value);
    let valid = true;
    if (fullName.length < 2 || fullName.length > 80) { fieldError("fullName", "Enter your full name."); valid = false; }
    if (dateOfBirth && new Date(dateOfBirth) > new Date()) { fieldError("dateOfBirth", "Date of birth cannot be in the future."); valid = false; }
    if (address.length > 200) { fieldError("address", "Keep the address under 200 characters."); valid = false; }
    if (phoneNumber && !PHONE_RE.test(phoneNumber)) { fieldError("phoneNumber", "Enter a valid phone number."); valid = false; }
    if (!valid) return;

    const button = $("#save-btn");
    setBusy(button, true);
    try {
      await setDoc(doc(db, "Users", uid), {
        uid, fullName, email: auth.currentUser.email, dateOfBirth, gender, address, phoneNumber, profileImage: photo
      }, { merge: true });
      if (auth.currentUser.displayName !== fullName) await updateProfile(auth.currentUser, { displayName: fullName });
      setTopAvatar(photo);
      toast("Personal information saved.");
      await syncSharedCard(uid);
    } catch (err) {
      console.error(err);
      formError(form, "Could not save. Check your connection and Firestore rules.");
    }
    setBusy(button, false);
  });
  finishLoading();
}

/*QR code and privacy*/

async function initQr(uid) {
  let [user, medical, contacts] = await loadAll(uid);
  setTopAvatar(user.profileImage);
  const primary = primaryContact(contacts);
  const hasData = {
    fullName: Boolean(clean(user.fullName)),
    photo: Boolean(user.profileImage),
    bloodType: Boolean(clean(medical.bloodType)),
    allergies: Boolean(clean(medical.allergies)),
    conditions: Boolean(clean(medical.medicalConditions)),
    medications: Boolean(clean(medical.medications)),
    notes: Boolean(clean(medical.medicalNotes)),
    contactName: Boolean(primary),
    contactPhone: Boolean(primary && clean(primary.phoneNumber))
  };
  const privacy = { ...DEFAULT_PRIVACY, ...(user.privacy || {}) };

  $("#privacy-list").innerHTML = PRIVACY_FIELDS.map(([key, label]) => `
    <label class="switch-row">
      <span class="switch-text"><strong>${label}</strong>${hasData[key] ? "" : "<small>Nothing saved yet</small>"}</span>
      <input type="checkbox" class="switch" data-key="${key}" ${privacy[key] ? "checked" : ""}>
    </label>`).join("");

  const readPrivacy = () => {
    const result = {};
    $$("#privacy-list input").forEach((box) => { result[box.dataset.key] = box.checked; });
    return result;
  };

  function renderPreview() {
    const current = readPrivacy();
    const items = PRIVACY_FIELDS.filter(([key]) => current[key] && hasData[key]).map(([, label]) => `<li>${label}</li>`);
    $("#preview-list").innerHTML = items.length ? items.join("") : "<li>Nothing. The card would be empty.</li>";
  }

  function renderShareState() {
    const on = Boolean(user.shareToken);
    $("#share-off").classList.toggle("hidden", on);
    $("#share-on").classList.toggle("hidden", !on);
    if (on) {
      const url = shareUrl(user.shareToken);
      $("#share-link").value = url;
      const canvas = $("#qr-canvas");
      if (canvas) drawQr(canvas, url, 240);
      const host = location.hostname;
      const local = location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(host) ||
        /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
      $("#host-warning").classList.toggle("hidden", !local);
    }
  }

  $("#privacy-list").addEventListener("change", renderPreview);

  async function saveUserShareFields(fields) {
    await setDoc(doc(db, "Users", uid), fields, { merge: true });
    user = { ...user, ...fields };
  }

  $("#enable-btn").addEventListener("click", async (event) => {
    const ok = await confirmDialog({
      title: "Create a shareable QR code?",
      message: "Anyone who scans the code or has the link can see the items listed under 'Visible to anyone with the link'. You can turn sharing off at any time.",
      okLabel: "Create QR code"
    });
    if (!ok) return;
    const button = event.currentTarget;
    setBusy(button, true);
    try {
      const token = makeToken();
      const chosen = readPrivacy();
      await writeSharedCard(uid, token, chosen);
      await saveUserShareFields({ shareToken: token, privacy: chosen });
      renderShareState();
      toast("QR code created.");
    } catch (err) {
      console.error(err);
      toast("Could not create the QR code. Check your Firestore rules.", "error");
    }
    setBusy(button, false);
  });

  $("#save-btn").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    setBusy(button, true);
    try {
      const chosen = readPrivacy();
      await writeSharedCard(uid, user.shareToken, chosen);
      await saveUserShareFields({ privacy: chosen });
      toast("Sharing choices saved.");
    } catch (err) {
      console.error(err);
      toast("Could not save your choices.", "error");
    }
    setBusy(button, false);
  });

  $("#regen-btn").addEventListener("click", async (event) => {
    const ok = await confirmDialog({
      title: "Create a new QR code?",
      message: "The current QR code and link will stop working. Anyone who saved or printed the old code will lose access.",
      okLabel: "Create new code"
    });
    if (!ok) return;
    const button = event.currentTarget;
    setBusy(button, true);
    try {
      const oldToken = user.shareToken;
      const token = makeToken();
      const chosen = readPrivacy();
      await writeSharedCard(uid, token, chosen);
      await saveUserShareFields({ shareToken: token, privacy: chosen });
      await deleteDoc(doc(db, "SharedCards", oldToken));
      renderShareState();
      toast("New QR code created. The old one no longer works.");
    } catch (err) {
      console.error(err);
      toast("Could not create a new code.", "error");
    }
    setBusy(button, false);
  });

  $("#stop-btn").addEventListener("click", async (event) => {
    const ok = await confirmDialog({
      title: "Stop sharing?",
      message: "Your QR code and link will stop working right away. Your saved information is not deleted.",
      okLabel: "Stop sharing"
    });
    if (!ok) return;
    const button = event.currentTarget;
    setBusy(button, true);
    try {
      await deleteDoc(doc(db, "SharedCards", user.shareToken));
      await updateDoc(doc(db, "Users", uid), { shareToken: deleteField() });
      delete user.shareToken;
      renderShareState();
      toast("Sharing is off.");
    } catch (err) {
      console.error(err);
      toast("Could not turn sharing off.", "error");
    }
    setBusy(button, false);
  });

  $("#copy-btn").addEventListener("click", async () => { await copyText($("#share-link").value); toast("Link copied."); });
  $("#share-btn").addEventListener("click", () => shareLink($("#share-link").value, "Emergency Info Card"));
      $("#download-btn").addEventListener("click", () => {
    const c = $("#qr-canvas canvas");
    if (!c) return;
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = "emergency-info-card-qr.png";
    a.click();
  });

  renderPreview();
  renderShareState();
  finishLoading();
}

/*Settings*/

async function initSettings(uid) {
  const user = await getUserDoc(uid);
  setTopAvatar(user.profileImage);
  $("#account-email").textContent = auth.currentUser.email;

  const form = $("#password-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors(form);
    const current = $("#currentPassword").value;
    const next = $("#newPassword").value;
    const confirm = $("#confirmNewPassword").value;
    let valid = true;
    if (!current) { fieldError("currentPassword", "Enter your current password."); valid = false; }
    if (next.length < 8) { fieldError("newPassword", "Use at least 8 characters."); valid = false; }
    else if (next === current) { fieldError("newPassword", "Choose a password different from the current one."); valid = false; }
    if (confirm !== next) { fieldError("confirmNewPassword", "Passwords do not match."); valid = false; }
    if (!valid) return;

    const button = $("#pw-btn");
    setBusy(button, true);
    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, current);
      await reauthenticateWithCredential(auth.currentUser, credential);
      await updatePassword(auth.currentUser, next);
      form.reset();
      toast("Password changed.");
    } catch (err) {
      if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password") {
        fieldError("currentPassword", "Current password is incorrect.");
      } else {
        formError(form, authMessage(err));
      }
    }
    setBusy(button, false);
  });

  const dialog = $("#delete-dialog");
  const deleteForm = $("#delete-form");
  $("#delete-btn").addEventListener("click", () => { clearErrors(deleteForm); deleteForm.reset(); dialog.showModal(); });
  $("#cancel-delete").addEventListener("click", () => dialog.close());

  deleteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors(deleteForm);
    const password = $("#deletePassword").value;
    if (!password) return fieldError("deletePassword", "Enter your password to confirm.");

    const button = $("#confirm-delete-btn");
    setBusy(button, true);
    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, password);
      await reauthenticateWithCredential(auth.currentUser, credential);

      const contacts = await getContacts(uid);
      const batch = writeBatch(db);
      contacts.forEach((c) => batch.delete(doc(db, "EmergencyContacts", c.contactId)));
      if (user.shareToken) batch.delete(doc(db, "SharedCards", user.shareToken));
      batch.delete(doc(db, "MedicalInformation", uid));
      batch.delete(doc(db, "Users", uid));
      await batch.commit();

      await deleteUser(auth.currentUser);
      location.replace("index.html");
    } catch (err) {
      if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password") {
        fieldError("deletePassword", "Password is incorrect.");
      } else {
        formError(deleteForm, authMessage(err));
      }
      setBusy(button, false);
    }
  });
  finishLoading();
}

/*Public shared card*/

async function initSharePage() {
  const fail = (message) => {
    $("#share-loading")?.remove();
    const box = $("#share-error");
    box.textContent = message;
    box.classList.remove("hidden");
  };

  const token = new URLSearchParams(location.search).get("t") || "";
  if (!/^[A-Za-z0-9]{32}$/.test(token)) return fail("This link is not valid.");
  if (!configReady) return fail("This app is not connected to Firebase yet.");

  try {
    const snap = await getDoc(doc(db, "SharedCards", token));
    if (!snap.exists()) return fail("This card is not available. The owner may have turned off sharing or created a new code.");
    $("#share-loading")?.remove();
    const data = snap.data().data || {};
    $("#share-card").innerHTML = cardHTML(data, { hideMissing: true });
    $("#share-card").classList.remove("hidden");
    $("#share-note").classList.remove("hidden");
  } catch (err) {
    console.error(err);
    fail("This card could not be loaded.");
  }
}

/*Start*/

document.addEventListener("click", async (event) => {
  if (event.target.closest('[data-action="toggle-theme"]')) {
    const current = document.documentElement.getAttribute("data-theme");
    applyTheme(current === "dark" ? "light" : "dark");
    return;
  }

  const toggle = event.target.closest(".toggle-pass");
  if (toggle) {
    const input = document.getElementById(toggle.dataset.target);
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    toggle.innerHTML = `<i class="fa-solid ${showing ? "fa-eye" : "fa-eye-slash"}"></i>`;
    toggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    return;
  }

  if (event.target.closest('[data-action="logout"]')) {
    await signOut(auth);
    location.replace("login.html");
  }
});


const PROTECTED_PAGES = {
  dashboard: initDashboard,
  "emergency-card": initEmergencyCard,
  "emergency-mode": initEmergencyMode,
  contacts: initContacts,
  "medical-info": initMedical,
  "personal-info": initPersonal,
  qr: initQr,
  settings: initSettings
};

if (!configReady) showConfigBanner();

if (page === "login" || page === "register") {
  if (page === "login") initLogin(); else initRegister();
  onAuthStateChanged(auth, (user) => {
    if (user && !registering) location.replace("dashboard.html");
  });
} else if (page === "share") {
  initSharePage();
} else if (PROTECTED_PAGES[page]) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { location.replace("login.html"); return; }
    if (pageStarted) return;
    pageStarted = true;
    renderShell();
    try {
      await PROTECTED_PAGES[page](user.uid);
    } catch (err) {
      showPageError(err);
    }
  });
}
if (!PROTECTED_PAGES[page] && page !== "emergency-mode") {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn floating-theme-btn";
  btn.dataset.action = "toggle-theme";
  btn.innerHTML = `<i class="fa-solid ${isDark ? "fa-sun" : "fa-moon"}"></i>`;
  document.body.appendChild(btn);
}
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service Worker registration failed:", err);
    });
  });
}
