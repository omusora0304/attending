import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// Firebaseの設定
// 実際の値はプロジェクト作成時に取得したものに置き換える
const firebaseConfig = {
  apiKey: "AIzaSyAjBPOVQwe9upIChaM_5BPSKbDXTJRvyiQ",
  authDomain: "kjattend-1f5db.firebaseapp.com",
  projectId: "kjattend-1f5db",
  storageBucket: "kjattend-1f5db.firebasestorage.app",
  messagingSenderId: "972990737841",
  appId: "1:972990737841:web:065e14be167de585056190"
};

// Firebaseの初期化
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);