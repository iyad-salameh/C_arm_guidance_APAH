import { initializeApp } from "firebase/app";

const firebaseConfig = {
    apiKey: "AIzaSyD8DuDyfQFH7mVoKmhtIGFIa5ePLFRk47U",
    authDomain: "c-arm-simulation.firebaseapp.com",
    projectId: "c-arm-simulation",
    storageBucket: "c-arm-simulation.firebasestorage.app",
    messagingSenderId: "476987684424",
    appId: "1:476987684424:web:887d6cd3760f989a92ca7d",
    measurementId: "G-SX5SSPQ7XY"
};

const app = initializeApp(firebaseConfig);

export default app;
