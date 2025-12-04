import React from 'react';
import { AppProvider, useAppContext } from './context/AppContext';
import MainLayout from './components/MainLayout';
import Login from './components/Login';
import { LoadingIcon } from './components/icons';

const AppContent: React.FC = () => {
    const { user, isAuthLoading, isDbLoading } = useAppContext();

    if (isAuthLoading || (user && isDbLoading)) {
        return (
            <div className="h-screen w-screen bg-gray-100 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <LoadingIcon className="h-12 w-12 text-indigo-600" />
                    <p className="text-gray-600 font-semibold">{isAuthLoading ? "Authenticating..." : "Loading schedules..."}</p>
                </div>
            </div>
        );
    }

    return user ? <MainLayout /> : <Login />;
};


const App: React.FC = () => {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
};

export default App;