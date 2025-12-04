import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
  getAuth, 
  onAuthStateChanged, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut as firebaseSignOut,
  User
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from '../firebaseConfig';
import { AppState } from '../types';

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);

// Export auth and firestore services
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

export const signInWithGoogle = () => signInWithPopup(auth, provider);

export const signOut = () => firebaseSignOut(auth);

export const onAuthStateChangedListener = (callback: (user: User | null) => void) => 
  onAuthStateChanged(auth, callback);

/**
 * Saves the core application state to a user-specific document in Firestore.
 * @param userId The UID of the authenticated user.
 * @param state The current application state to save.
 */
export const saveAppState = async (userId: string, state: AppState) => {
  if (!userId) return;
  const userDocRef = doc(db, 'users', userId);
  try {
    // We only save the core state, not transient UI state
    const stateToSave = {
        reps: state.reps,
        unassignedJobs: state.unassignedJobs,
        settings: state.settings,
    };
    await setDoc(userDocRef, { appState: stateToSave }, { merge: true });
  } catch (error) {
    console.error("Error saving app state to Firestore:", error);
    // Optionally, you could add user-facing error handling here
  }
};

/**
 * Loads the application state from a user-specific document in Firestore.
 * @param userId The UID of the authenticated user.
 * @returns The saved AppState, or null if no state is found or an error occurs.
 */
export const loadAppState = async (userId: string): Promise<AppState | null> => {
  if (!userId) return null;
  const userDocRef = doc(db, 'users', userId);
  try {
    const docSnap = await getDoc(userDocRef);
    if (docSnap.exists()) {
      const data = docSnap.data();
      // Basic validation to ensure the loaded data has the expected shape
      if (data.appState && Array.isArray(data.appState.reps)) {
        return data.appState as AppState;
      }
    }
    return null; // No state saved yet for this user
  } catch (error) {
    console.error("Error loading app state from Firestore:", error);
    return null;
  }
};
