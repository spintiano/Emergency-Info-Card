import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBypBhzHBSP_BXc3Od2IHsJCMN5pQCnVuk",
  authDomain: "emergency-info-card-57613.firebaseapp.com",
  projectId: "emergency-info-card-57613",
  storageBucket: "emergency-info-card-57613.firebasestorage.app",
  messagingSenderId: "264551326034",
  appId: "1:264551326034:web:ef967313fe8e8be5439a8b",
  measurementId: "G-RRKLC57FL6"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);