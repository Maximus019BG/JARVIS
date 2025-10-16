// firebase.ts
import { initializeApp } from "firebase/app";
import { getMessaging } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyDa9kMzePMbUKmJO7tx6akS9nkEP3N2W0s",
  authDomain: "test-moble-25319.firebaseapp.com",
  projectId: "test-moble-25319",
  storageBucket: "test-moble-25319.appspot.com",
  messagingSenderId: "1087098465481",
  appId: "1:1087098465481:android:295bfc851f64c7af453118",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const messaging = getMessaging(firebaseApp);
