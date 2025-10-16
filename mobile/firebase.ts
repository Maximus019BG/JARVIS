// firebase.ts
import { initializeApp } from "firebase/app";
import { getMessaging } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyAnGX6rEpn729bKX8kXWfs0CQFyYcEW4bY",
  authDomain: "jarvis-45a8c.firebaseapp.com",
  projectId: "jarvis-45a8c",
  storageBucket: "jarvis-45a8c.firebasestorage.app",
  messagingSenderId: "496096498945",
  appId: "1:496096498945:android:f1f0f47acb3fefaf267700",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const messaging = getMessaging(firebaseApp);
