import React from 'react';
import { AppProvider, useAppContext } from './context/AppContext';
import MainLayout from './components/MainLayout';
import Login from './components/Login';
import { LoadingIcon } from './components/icons';

const AuthGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthLoading } = useAppContext();

  if (isAuthLoading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-gray-100">
        <LoadingIcon className="h-10 w-10 text-indigo-600" />
        <p className="mt-4 text-gray-600 font-semibold">Authenticating...</p>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return <>{children}</>;
}


const App: React.FC = () => {
  return (
    <AppProvider>
      <AuthGuard>
        <MainLayout />
      </AuthGuard>
    </AppProvider>
  );
};

export default App;