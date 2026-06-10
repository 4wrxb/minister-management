import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Home from './pages/Home';
import PlayerForm from './pages/PlayerForm';
import UpdateSubmission from './pages/UpdateSubmission';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import PublishedSchedule from './pages/PublishedSchedule';
import PlayerGuide from './pages/PlayerGuide';
import AdminGuide from './pages/AdminGuide';
import LanguageSelector from './components/LanguageSelector';
import { getAppBase } from './utils/appBase';

function App() {
  const { i18n } = useTranslation();

  // Set document direction for RTL languages
  document.documentElement.dir = i18n.language === 'ar' ? 'rtl' : 'ltr';

  return (
    <Router basename={getAppBase()}>
      <div className="min-h-screen flex flex-col">
        <header className="w-full py-3 px-4 flex justify-end">
          <LanguageSelector />
        </header>
        <div className="flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/submit" element={<PlayerForm />} />
            <Route path="/update" element={<UpdateSubmission />} />
            <Route path="/schedule/:day" element={<PublishedSchedule />} />
            <Route path="/admin" element={<AdminLogin />} />
            <Route path="/admin/dashboard" element={<AdminDashboard />} />
            <Route path="/guide" element={<PlayerGuide />} />
            <Route path="/admin/guide" element={<AdminGuide />} />
          </Routes>
        </div>
        <footer className="mt-auto pb-4 text-center">
          <p className="text-xs italic text-theme-dim">compliments of the viscount, you're welcome 😂</p>
        </footer>
      </div>
    </Router>
  );
}

export default App;
