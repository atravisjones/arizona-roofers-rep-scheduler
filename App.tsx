import React from 'react';
import { AppProvider } from './context/AppContext';
import MainLayout from './components/MainLayout';
import AuthGate from './components/AuthGate';

const App: React.FC = () => {
  return (
    <AuthGate>
      <AppProvider>
        <MainLayout />
      </AppProvider>
    </AuthGate>
  );
};

export default App;
