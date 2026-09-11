import React from 'react';
import { AppProvider } from './context/AppContext';
import MainLayout from './components/MainLayout';
import AuthGate from './components/AuthGate';
import MySchedulePage from './components/MySchedulePage';

// Phone-first rep self-service page: no planner shell, no AppProvider (keeps it light on a phone).
const MY_SCHEDULE_PATH = '/my-schedule';
const isMySchedule = () => typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') === MY_SCHEDULE_PATH;

const App: React.FC = () => {
  if (isMySchedule()) {
    return (
      <AuthGate>
        <MySchedulePage />
      </AuthGate>
    );
  }
  return (
    <AuthGate>
      <AppProvider>
        <MainLayout />
      </AppProvider>
    </AuthGate>
  );
};

export default App;
