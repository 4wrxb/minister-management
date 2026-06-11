import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Shield, ArrowLeft, AlertCircle } from 'lucide-react';
import axios from 'axios';

export default function AdminLogin() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await axios.post('/api/admin/login', { password });

      // Store token and role in localStorage
      localStorage.setItem('adminToken', response.data.token);
      localStorage.setItem('adminRole', response.data.role);

      // Navigate to dashboard
      navigate('/admin/dashboard');
    } catch (err) {
      const msg = (axios.isAxiosError(err) && err.response?.data?.error) || t('admin.invalidPassword');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-dark-card rounded-2xl p-8 border border-theme-border max-w-md w-full">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-theme-dim hover:text-theme-text mb-6"
        >
          <ArrowLeft className="w-5 h-5" />
          {t('update.backHome')}
        </button>

        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-accent/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Shield className="w-10 h-10 text-accent" />
          </div>
          <h2 className="text-3xl font-bold text-accent mb-2">
            {t('admin.title')}
          </h2>
          <p className="text-theme-dim">{t('admin.enterPassword')}</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-theme-text mb-2">
              {t('admin.password')}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-dark-input border border-theme-border rounded-lg text-theme-text focus:ring-2 focus:ring-accent focus:border-accent"
              required
            />
          </div>

          {error && (
            <div className="p-4 bg-danger/10 border border-danger/30 rounded-lg flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-danger" />
              <p className="text-danger">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full px-6 py-3 bg-accent text-dark-bg rounded-lg hover:bg-accent-dim font-medium transition-colors disabled:opacity-50"
          >
            {loading ? t('form.loading') : t('admin.login')}
          </button>
        </form>
      </div>
    </div>
  );
}
