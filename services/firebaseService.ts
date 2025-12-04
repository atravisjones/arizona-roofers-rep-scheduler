import firebase, { auth, firestore, googleProvider } from '../firebaseConfig';
// FIX: Correct the import for AppState to come from types.ts
import { AppState } from '../types';
import { DEFAULT_SETTINGS } from '../context/useAppLogic';

/**
 * Initiates the Google Sign-In popup flow.
 */
export const signInWithGoogle = async (): Promise<void> => {
    try {
        await auth.signInWithPopup(googleProvider);
    } catch (error) {
        console.error("Error during Google sign-in:", error);
        throw error;
    }
};

/**
 * Signs the current user out.
 */
export const signOut = async (): Promise<void> => {
    try {
        await auth.signOut();
    } catch (error) {
        console.error("Error during sign-out:", error);
        throw error;
    }
};

/**
 * Sets up a real-time listener for authentication state changes.
 * @param callback The function to call when the auth state changes.
 * @returns An unsubscribe function to clean up the listener.
 */
export const onAuthStateChanged = (callback: (user: firebase.User | null) => void): firebase.Unsubscribe => {
    return auth.onAuthStateChanged(callback);
};

/**
 * Retrieves the document reference for a specific user.
 * @param uid The user's unique ID.
 * @returns A DocumentReference for the user's data.
 */
const getUserDocRef = (uid: string) => firestore.collection('users').doc(uid);


/**
 * Retrieves the collection reference for a user's daily schedules.
 * @param uid The user's unique ID.
 * @returns A CollectionReference for the user's schedules.
 */
const getSchedulesColRef = (uid: string) => getUserDocRef(uid).collection('schedules');


/**
 * Sets up a real-time listener for a specific day's schedule data.
 * If the document doesn't exist, it creates it with a default state.
 * @param uid The user's unique ID.
 * @param dateKey The date string in 'YYYY-MM-DD' format.
 * @param callback The function to call with the AppState data.
 * @returns An unsubscribe function to clean up the listener.
 */
export const onScheduleSnapshot = (
    uid: string,
    dateKey: string,
    callback: (data: AppState) => void
): firebase.Unsubscribe => {
    const docRef = getSchedulesColRef(uid).doc(dateKey);

    return docRef.onSnapshot(async (doc) => {
        if (doc.exists) {
            const data = doc.data() as AppState;
            // Ensure settings are merged with defaults in case new settings are added
            const mergedState: AppState = {
                ...data,
                settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
            };
            callback(mergedState);
        } else {
            // Document doesn't exist, so create it with a default empty state
            console.log(`No schedule found for ${dateKey}. Creating a new one.`);
            const defaultState: AppState = {
                reps: [],
                unassignedJobs: [],
                settings: DEFAULT_SETTINGS
            };
            try {
                await docRef.set(defaultState);
                // The onSnapshot listener will be re-triggered with the new data,
                // so we don't need to call the callback here.
            } catch (error) {
                console.error("Error creating new schedule document:", error);
            }
        }
    }, (error) => {
        console.error("Error on schedule snapshot:", error);
    });
};

/**
 * Updates the entire AppState for a given day in Firestore.
 * This is used for operations that modify the state, like adding jobs, assigning reps, etc.
 * @param uid The user's unique ID.
 * @param dateKey The date string in 'YYYY-MM-DD' format.
 * @param newState The complete new state object to save.
 */
export const updateSchedule = async (
    uid: string,
    dateKey: string,
    newState: AppState
): Promise<void> => {
    const docRef = getSchedulesColRef(uid).doc(dateKey);
    try {
        await docRef.set(newState, { merge: true });
    } catch (error) {
        console.error("Error updating schedule:", error);
        throw error;
    }
};

/**
 * Fetches rep data from the legacy Google Sheet.
 * This should only be used for a one-time import for new users.
 */
export const importRepsFromGoogleSheet = async (): Promise<any[]> => {
    // This is a placeholder for the logic that was in `googleSheetsService`.
    // For this migration, we'll assume a new user starts with an empty rep list
    // and adds them manually or via a new import feature.
    console.log("Simulating import of reps. In a real scenario, you'd fetch from Google Sheets here.");
    return [];
};
