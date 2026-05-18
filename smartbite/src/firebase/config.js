import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDxHZJ1BX4alB8LLbT9kskyqm-jKVFipUo",
  authDomain: "smart-canteen-e44e9.firebaseapp.com",
  projectId: "smart-canteen-e44e9",
  storageBucket: "smart-canteen-e44e9.firebasestorage.app",
  messagingSenderId: "509602872969",
  appId: "1:509602872969:web:c30a4eb11a448b9084d058",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
