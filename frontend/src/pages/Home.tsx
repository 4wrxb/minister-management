import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileText, Edit, Shield, Calendar, HelpCircle, Clock } from 'lucide-react';
import axios from 'axios';

export default function Home() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [publishedDays, setPublishedDays] = useState<string[]>([]);
  const [stateNumber, setStateNumber] = useState('2694');
  const [closingTime, setClosingTime] = useState('');
  const [isClosed, setIsClosed] = useState(false);

  useEffect(() => {
    axios.get('/api/settings/published-days')
      .then(res => setPublishedDays(res.data.published_days || []))
      .catch(() => {});

    axios.get('/api/settings/state-number')
      .then(res => setStateNumber(res.data.state_number || '2694'))
      .catch(() => {});

    axios.get('/api/settings/application-closing-time')
      .then(res => {
        setClosingTime(res.data.closing_time || '');
        setIsClosed(res.data.is_closed || false);
      })
      .catch(() => {});
  }, []);

  // Client-side check every 30s to auto-update isClosed
  useEffect(() => {
    if (!closingTime) return;
    const check = () => {
      const now = new Date();
      const close = new Date(closingTime);
      setIsClosed(now >= close);
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [closingTime]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-4">
          <p className="text-2xl text-theme-text font-semibold">
            {t('home.welcome', { state: stateNumber })}
          </p>
          {closingTime && (
            <div className={`mt-2 flex items-center justify-center gap-2 text-sm font-medium ${isClosed ? 'text-danger' : 'text-success'}`}>
              <Clock className="w-4 h-4" />
              {isClosed
                ? t('home.applicationsClosed')
                : t('home.applicationsCloseAt', { time: new Date(closingTime).toLocaleString() })
              }
            </div>
          )}
        </div>

        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-accent mb-4">
            {t('home.title')}
          </h1>
          <p className="text-xl text-theme-dim">
            {t('home.subtitle')}
          </p>
        </div>

        {/* Published Schedule Links */}
        {publishedDays.length > 0 && (
          <div className="mb-8 space-y-3">
            {publishedDays.map(day => (
              <button
                key={day}
                onClick={() => navigate(`/schedule/${day}`)}
                className="w-full bg-accent/10 border-2 border-accent/40 rounded-2xl p-5 hover:bg-accent/20 transition-all duration-300 group"
              >
                <div className="flex items-center justify-center gap-4">
                  <Calendar className="w-7 h-7 text-accent" />
                  <div className="text-center">
                    <h2 className="text-lg font-bold text-accent">
                      {t('schedule.viewSchedule')}
                    </h2>
                    <p className="text-theme-dim">
                      {t(`admin.${day}`)}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-6">
          {/* Submit New Application */}
          <button
            onClick={() => !isClosed && navigate('/submit')}
            disabled={isClosed}
            className={`bg-dark-card rounded-2xl p-8 border border-theme-border transition-all duration-300 group relative ${
              isClosed
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-dark-card-hover transform hover:-translate-y-2'
            }`}
          >
            <div className="flex flex-col items-center text-center">
              <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 transition-colors ${
                isClosed ? 'bg-theme-dim/20' : 'bg-accent/20 group-hover:bg-accent/30'
              }`}>
                <FileText className={`w-10 h-10 ${isClosed ? 'text-theme-dim' : 'text-accent'}`} />
              </div>
              <h2 className="text-2xl font-bold text-theme-text mb-3">
                {t('home.submitNew')}
              </h2>
              <p className="text-theme-dim">
                {isClosed ? t('home.applicationsClosedCard') : t('home.submitDesc')}
              </p>
            </div>
          </button>

          {/* Update Submission */}
          <button
            onClick={() => navigate('/update')}
            className="bg-dark-card rounded-2xl p-8 border border-theme-border hover:bg-dark-card-hover transform hover:-translate-y-2 transition-all duration-300 group"
          >
            <div className="flex flex-col items-center text-center">
              <div className="w-20 h-20 bg-success/20 rounded-full flex items-center justify-center mb-6 group-hover:bg-success/30 transition-colors">
                <Edit className="w-10 h-10 text-success" />
              </div>
              <h2 className="text-2xl font-bold text-theme-text mb-3">
                {t('home.updateExisting')}
              </h2>
              <p className="text-theme-dim">
                {t('home.updateDesc')}
              </p>
            </div>
          </button>

          {/* Admin Access */}
          <button
            onClick={() => navigate('/admin')}
            className="bg-dark-card rounded-2xl p-8 border border-theme-border hover:bg-dark-card-hover transform hover:-translate-y-2 transition-all duration-300 group"
          >
            <div className="flex flex-col items-center text-center">
              <div className="w-20 h-20 bg-accent/20 rounded-full flex items-center justify-center mb-6 group-hover:bg-accent/30 transition-colors">
                <Shield className="w-10 h-10 text-accent" />
              </div>
              <h2 className="text-2xl font-bold text-theme-text mb-3">
                {t('admin.title')}
              </h2>
              <p className="text-theme-dim">
                {t('home.adminDesc')}
              </p>
            </div>
          </button>
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={() => navigate('/guide')}
            className="inline-flex items-center gap-2 text-accent hover:text-accent-dim transition-colors text-sm font-medium"
          >
            <HelpCircle className="w-4 h-4" />
            {t('playerGuide.linkText')}
          </button>
        </div>

        <div className="mt-4 text-center text-theme-dim text-sm">
          <p>{t('home.utcNote')}</p>
        </div>
      </div>
    </div>
  );
}
