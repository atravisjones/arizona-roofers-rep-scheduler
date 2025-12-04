import React from 'react';
import { useAppContext } from '../context/AppContext';

const GoogleIcon = () => (
    <svg className="w-5 h-5" viewBox="0 0 48 48">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
        <path fill="none" d="M0 0h48v48H0z"></path>
    </svg>
);


const Login: React.FC = () => {
    const { signInWithGoogle } = useAppContext();

    return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-gray-100 p-4">
            <div className="w-full max-w-md bg-white rounded-xl shadow-2xl p-8 text-center border border-gray-200">
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                    Rep Route Planner
                </h1>
                <p className="mt-2 text-sm text-gray-600">
                    Sign in to access your saved schedules and jobs.
                </p>
                <div className="mt-8">
                    <button
                        onClick={signInWithGoogle}
                        className="w-full inline-flex justify-center items-center gap-3 py-3 px-4 bg-white border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                    >
                        <GoogleIcon />
                        Sign in with Google
                    </button>
                </div>
                <p className="mt-6 text-xs text-gray-400">
                    Your schedule data will be securely stored and associated with your Google account.
                </p>
            </div>
        </div>
    );
};

export default Login;
