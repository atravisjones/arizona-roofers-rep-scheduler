import React from 'react';
import { useAppContext } from '../context/AppContext';
import { RoofIcon } from './icons';

const Login: React.FC = () => {
    const { signInWithGoogle } = useAppContext();

    return (
        <div className="h-screen w-screen bg-gray-100 flex items-center justify-center">
            <div className="text-center bg-white p-12 rounded-lg shadow-xl animate-fade-in">
                <RoofIcon className="h-12 w-12 text-indigo-600 mx-auto mb-4" />
                <h1 className="text-2xl font-bold text-gray-800 mb-2">Rep Route Planner</h1>
                <p className="text-gray-500 mb-8">Sign in with your Google account to continue.</p>
                <button
                    onClick={signInWithGoogle}
                    className="flex items-center justify-center gap-3 w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg transition-transform transform hover:scale-105"
                >
                    <svg className="w-6 h-6" viewBox="0 0 48 48">
                        <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C12.955 4 4 12.955 4 24s8.955 20 20 20s20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
                        <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4C16.318 4 9.656 8.337 6.306 14.691z" />
                        <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
                        <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C42.012 35.816 44 30.138 44 24c0-1.341-.138-2.65-.389-3.917z" />
                    </svg>
                    Sign in with Google
                </button>
            </div>
        </div>
    );
};

export default Login;